use tauri::{PhysicalPosition, WebviewWindow};

/// The title strip (traffic lights and drag area) must be reachable, not just
/// any part of the window.
const TITLE_STRIP_HEIGHT: i64 = 40;
/// Require this much of the title strip to be visible on one monitor.
const MIN_VISIBLE_WIDTH: i64 = 160;
/// A window that is only barely peeking into a work area is still unusable.
const MIN_VISIBLE_HEIGHT: i64 = 120;

/// A monitor's usable area in physical pixels, independent of Tauri types so
/// the placement rules can be unit tested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WorkArea {
    fn left(self) -> i64 {
        i64::from(self.x)
    }

    fn top(self) -> i64 {
        i64::from(self.y)
    }

    fn right(self) -> i64 {
        self.left() + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        self.top() + i64::from(self.height)
    }
}

struct Rect {
    left: i64,
    top: i64,
    right: i64,
    bottom: i64,
}

impl Rect {
    fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        let left = i64::from(x);
        let top = i64::from(y);
        Self {
            left,
            top,
            right: left + i64::from(width),
            bottom: top + i64::from(height),
        }
    }

    fn width(&self) -> i64 {
        self.right - self.left
    }

    fn height(&self) -> i64 {
        self.bottom - self.top
    }
}

fn overlap(start_a: i64, end_a: i64, start_b: i64, end_b: i64) -> i64 {
    end_a.min(end_b) - start_a.max(start_b)
}

/// macOS restores a window to its previous frame even when that display is no
/// longer connected, which can leave the window completely off-screen. Return
/// a corrected top-left position when the window is not usefully visible.
pub(crate) fn corrected_position(
    position: (i32, i32),
    size: (u32, u32),
    monitors: &[WorkArea],
    preferred: Option<WorkArea>,
) -> Option<(i32, i32)> {
    let window = Rect::new(position.0, position.1, size.0, size.1);

    let visible = monitors.iter().any(|area| {
        let x_overlap = overlap(window.left, window.right, area.left(), area.right());
        let y_overlap = overlap(window.top, window.bottom, area.top(), area.bottom());
        let title_bottom = (window.top + TITLE_STRIP_HEIGHT).min(window.bottom);
        let title_overlap = overlap(window.left, window.right, area.left(), area.right());
        let title_height = overlap(window.top, title_bottom, area.top(), area.bottom());

        x_overlap >= MIN_VISIBLE_WIDTH.min(window.width())
            && y_overlap >= MIN_VISIBLE_HEIGHT.min(window.height())
            && title_overlap >= MIN_VISIBLE_WIDTH.min(window.width())
            && title_height > 0
    });
    if visible {
        return None;
    }

    let target = preferred.or_else(|| monitors.first().copied())?;
    let target_x = target.left();
    let target_y = target.top();
    let max_x = target.right() - window.width();
    let max_y = target.bottom() - window.height();

    let centered_x = target_x + (i64::from(target.width) - window.width()).max(0) / 2;
    let centered_y = target_y + (i64::from(target.height) - window.height()).max(0) / 2;

    let x = if max_x < target_x {
        target_x
    } else {
        centered_x.clamp(target_x, max_x)
    };
    let y = if max_y < target_y {
        target_y
    } else {
        centered_y.clamp(target_y, max_y)
    };

    Some((x as i32, y as i32))
}

/// Move the main window back onto a connected monitor when macOS restored it
/// to a frame that is no longer visible.
pub(crate) fn ensure_on_screen(window: &WebviewWindow) -> tauri::Result<()> {
    let monitors = window.available_monitors()?;
    if monitors.is_empty() {
        return Ok(());
    }

    let areas: Vec<WorkArea> = monitors
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            WorkArea {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect();
    let preferred = window.primary_monitor()?.map(|monitor| {
        let area = monitor.work_area();
        WorkArea {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    });

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    if let Some((x, y)) = corrected_position(
        (position.x, position.y),
        (size.width, size.height),
        &areas,
        preferred,
    ) {
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: WorkArea = WorkArea {
        x: 0,
        y: 25,
        width: 1680,
        height: 1025,
    };

    #[test]
    fn keeps_a_window_that_is_fully_visible() {
        assert_eq!(
            corrected_position((80, 80), (1280, 820), &[PRIMARY], Some(PRIMARY)),
            None
        );
    }

    #[test]
    fn moves_a_window_restored_above_the_display() {
        // A frame observed on an Intel Mac when only the primary display was
        // connected.
        let position = corrected_position((45, -1086), (1280, 820), &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, Some((200, 127)));
    }

    #[test]
    fn moves_a_window_that_is_entirely_to_the_right() {
        let position = corrected_position((2000, 100), (1280, 820), &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, Some((200, 127)));
    }

    #[test]
    fn requires_the_title_strip_to_be_reachable() {
        // The bottom edge is visible, but the title strip is off-screen.
        let position = corrected_position((-900, -700), (1280, 820), &[PRIMARY], Some(PRIMARY));
        assert_eq!(position, Some((200, 127)));
    }

    #[test]
    fn keeps_a_window_on_a_secondary_monitor() {
        let secondary = WorkArea {
            x: 1680,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            corrected_position(
                (1800, 100),
                (1280, 820),
                &[PRIMARY, secondary],
                Some(PRIMARY)
            ),
            None
        );
    }

    #[test]
    fn keeps_a_window_that_is_visible_on_an_offset_monitor() {
        // The three-display layout used for the Intel launch test: the built-in
        // display is primary and the external monitors sit above it.
        let primary = WorkArea {
            x: 98,
            y: 50,
            width: 2782,
            height: 1750,
        };
        let left = WorkArea {
            x: -275,
            y: -1175,
            width: 1920,
            height: 1175,
        };
        let right = WorkArea {
            x: 1645,
            y: -1087,
            width: 1680,
            height: 1025,
        };
        assert_eq!(
            corrected_position(
                (45, -1086),
                (1280, 820),
                &[primary, left, right],
                Some(primary)
            ),
            None
        );
    }

    #[test]
    fn pins_a_window_larger_than_the_work_area_to_the_origin() {
        let small = WorkArea {
            x: 0,
            y: 25,
            width: 1024,
            height: 768,
        };
        assert_eq!(
            corrected_position((5000, 5000), (1280, 820), &[small], Some(small)),
            Some((0, 25))
        );
    }

    #[test]
    fn returns_none_without_monitors() {
        assert_eq!(
            corrected_position((45, -1086), (1280, 820), &[], None),
            None
        );
    }
}
