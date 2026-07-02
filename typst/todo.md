# TODO

* Feature: Make drag-n-drop view synchronized with PDF preview when scrolling.
* Feature: Toggle page view vs. contiguous view on drag-n-drop view.
* Feature: Allow drag-to-resize in drag-n-drop view
* Bug: Cannot drag a canvas element off of a canvas.
    * The correct behavior is that when moving a canvas element off of a canvas,
      the canvas element should be unwrapped and its wrapped element placed
      instead. When moving between canvases, it either be unwrapped or used as
      is (if unwrapped, it would follow the same path from that point on as a
      new element being added to the canvas).
* Feature: Undo/redo stack
* Feature: Canvas "snap"
    * Enable "snap" feature by toggle setting
    * elements will snap to grid
        * User can set the grid size
* Feature: Align elements
    * Per element, give setting in the inspection area to align [left, middle,
      right] and [top, middle, bottom]. 
    * Present as buttons oriented positionally where they correspond to.
* Bug: Pallete and inspection area do not fit content fully
* Feature: Run as executable (hide npm/server/browser details)
* Feature: Multi-element selection/select all (ctrl + a)
* Feature: up/down arrows for font size
* Feature: Display grid/stack layout elements as they would render
* Feature: Input validation
* Create a spec
