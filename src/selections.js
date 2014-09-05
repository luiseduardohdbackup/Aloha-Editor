/**
 * selections.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor.
 * Copyright (c) 2010-2014 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php
 *
 * @TODO: better climbing
 *        ie support
 */
define([
	'dom',
	'keys',
	'maps',
	'html',
	'mouse',
	'events',
	'arrays',
	'ranges',
	'carets',
	'browsers',
	'overrides',
	'animation',
	'boundaries',
	'traversing',
	'functions'
], function (
	Dom,
	Keys,
	Maps,
	Html,
	Mouse,
	Events,
	Arrays,
	Ranges,
	Carets,
	Browsers,
	Overrides,
	Animation,
	Boundaries,
	Traversing,
	Fn
) {
	'use strict';

	/**
	 * Hides all visible caret elements and returns all those that were hidden
	 * in this operation.
	 *
	 * @param  {Document} doc * @return {Array.<Element>}
	 */
	function hideCarets(doc) {
		var carets = doc.querySelectorAll('div.aloha-caret');
		var visible = [];
		[].forEach.call(carets, function (caret) {
			if ('block' === Dom.getStyle(caret, 'display')) {
				visible.push(caret);
				Dom.setStyle(caret, 'display', 'none');
			}
		});
		return visible;
	}

	/**
	 * Unhides the given list of caret elements.
	 *
	 * @param {Array.<Element>} carets
	 */
	function unhideCarets(carets) {
		carets.forEach(function (caret) {
			Dom.setStyle(caret, 'display', 'block');
		});
	}

	/**
	 * Renders the given element at the specified boundary to represent the
	 * caret position.
	 *
	 * @param {Element}  caret
	 * @param {Boundary} boundary
	 */
	function show(caret, boundary) {
		var box = Carets.box(Boundaries.range(boundary, boundary));
		Maps.extend(caret.style, {
			'top'     : box.top + 'px',
			'left'    : box.left + 'px',
			'height'  : box.height + 'px',
			'width'   : '5px',
			'display' : 'block'
		});
	}

	/**
	 * Determines how to style a caret element based on the given overrides.
	 *
	 * @private
	 * @param  {Object} overrides
	 * @return {Object} A map of style properties and their values
	 */
	function stylesFromOverrides(overrides) {
		var style = {};
		style['padding'] = overrides['bold'] ? '1px' : '0px';
		style[Browsers.VENDOR_PREFIX + 'transform']
				= overrides['italic'] ? 'rotate(16deg)' : '';
		style['background'] = overrides['color'] || 'black';
		return style;
	}

	/**
	 * Given the containers and offsets representing a start and end boundary,
	 * checks whether the end boundary preceeds the start boundary in document
	 * order.
	 *
	 * @private
	 * @param  {Element} sc Start container
	 * @param  {string}  so Start offset
	 * @param  {Element} ec End container
	 * @param  {string}  eo End offset
	 * @return {boolean}
	 *         True if the boundary positions are reversed.
	 */
	function isReversed(sc, so, ec, eo) {
		return (sc === ec && so > eo) || Dom.followedBy(ec, sc);
	}

	/**
	 * Creates a range that is `stride` pixels above the given offset bounds.
	 *
	 * @private
	 * @param  {Object.<string, number>} box
	 * @param  {number}                  stride
	 * @param  {Document}                doc
	 * @return {Range}
	 */
	function up(box, stride, doc) {
		var boundaries = Boundaries.fromPosition(box.left, box.top - stride, doc);
		return boundaries && Boundaries.range(boundaries[0], boundaries[1]);
	}

	/**
	 * Creates a range that is `stride` pixels below the given offset bounds.
	 *
	 * @private
	 * @param  {Object.<string, number>} box
	 * @param  {number}                  stride
	 * @return {Range}
	 */
	function down(box, stride, doc) {
		var boundaries = Boundaries.fromPosition(box.left, box.top + box.height + stride, doc);
		return boundaries && Boundaries.range(boundaries[0], boundaries[1]);
	}

	/**
	 * Given two ranges, creates a range that is between the two.
	 *
	 * @private
	 * @param  {Range}  a
	 * @param  {Range}  b
	 * @param  {string} focus Either "start" or "end"
	 * @return {Object}
	 */
	function mergeRanges(a, b, focus) {
		var sc, so, ec, eo;
		if ('start' === focus) {
			sc = a.startContainer;
			so = a.startOffset;
			ec = b.endContainer;
			eo = b.endOffset;
		} else {
			sc = b.startContainer;
			so = b.startOffset;
			ec = a.endContainer;
			eo = a.endOffset;
		}
		if (isReversed(sc, so, ec, eo)) {
			return {
				range: Ranges.create(ec, eo, sc, so),
				focus: ('start' === focus) ? 'end' : 'start'
			};
		}
		return {
			range: Ranges.create(sc, so, ec, eo),
			focus: focus
		};
	}

	/**
	 * Jumps the front or end position of the given editable.
	 *
	 * @private
	 * @param  {string} direction "up" or "down"
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function jump(direction, event, range, focus) {
		var boundary;
		if ('up' === direction) {
			boundary = Boundaries.create(event.editable.elem, 0);
			boundary = Html.expandForward(boundary);
		} else {
			boundary = Boundaries.fromEndOfNode(event.editable.elem);
			boundary = Html.expandBackward(boundary);
		}
		var next = Boundaries.range(boundary, boundary);
		if (!Events.hasKeyModifier(event, 'shift')) {
			return {
				range: next,
				focus: focus
			};
		}
		return mergeRanges(next, range, focus);
	}

	/**
	 * Determines the closest visual caret position above or below the given
	 * range.
	 *
	 * @private
	 * @param  {string} direction "up" or "down"
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function climb(direction, event, range, focus) {
		var boundary = ('start' === focus)
		             ? Boundaries.fromRangeStart(range)
		             : Boundaries.fromRangeEnd(range);
		var clone = Boundaries.range(boundary, boundary);
		var box = Carets.box(clone);
		var doc = range.commonAncestorContainer.ownerDocument;
		var win = Dom.documentWindow(doc);
		var topOffset = win.pageYOffset - doc.body.clientTop;
		var leftOffset = win.pageXOffset - doc.body.clientLeft;

		box.top -= topOffset;
		box.left -= leftOffset;

		var half = box.height / 2;
		var stride = half;
		var move = ('up' === direction) ? up : down;
		var next = move(box, stride, doc);

		// TODO: also check if `next` and `clone` are *visually* adjacent
		while (next && Ranges.equals(next, clone)) {
			stride += half;
			next = move(box, stride, doc);
		}
		if (!next) {
			return;
		}
		if (!Events.hasKeyModifier(event, 'shift')) {
			return {
				range: next,
				focus: focus
			};
		}
		return mergeRanges(next, range, focus);
	}

	/**
	 * Determines the next visual caret position before or after the given
	 * range.
	 *
	 * @private
	 * @param  {string} direction "left" or "right"
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function step(direction, event, range, focus) {
		var shift = Events.hasKeyModifier(event, 'shift');
		var start = Boundaries.fromRangeStart(range);
		var end = Boundaries.fromRangeEnd(range);
		var collapsed = Boundaries.equals(start, end);
		if (collapsed || !shift) {
			focus = ('left' === direction) ? 'start' : 'end';
		}
		var boundary = ('start' === focus)
		             ? start
		             : Traversing.envelopeInvisibleCharacters(end);
		if (collapsed || shift) {
			var stride = (Events.hasKeyModifier(event, 'ctrl')
			           || Events.hasKeyModifier(event, 'alt'))
			           ? 'word'
			           : 'visual';
			var next = ('left' === direction)
			         ? Traversing.prev(boundary, stride)
			         : Traversing.next(boundary, stride);
			if (Dom.isEditingHost(Boundaries.container(next))) {
				if (Boundaries.isAtStart(boundary)) {
					next = Html.expandForward(boundary);
				} else if (Boundaries.isAtEnd(boundary)) {
					next = Html.expandBackward(boundary);
				}
			}
			if (next) {
				boundary = next;
			}
		}
		var clone;
		if (!shift) {
			clone = Boundaries.range(boundary, boundary);
		} else {
			clone = ('start' === focus)
			      ? Boundaries.range(boundary, end)
			      : Boundaries.range(start, boundary);
		}
		return {
			range: clone,
			focus: focus
		};
	}

	/**
	 * Caret movement operations mapped against cursor key keycodes.
	 *
	 * @private
	 * @type {Object.<string, function(Event, Range, string):Object>}
	 */
	var movements = {};
	movements[Keys.CODES['up']] = Fn.partial(climb, 'up');
	movements[Keys.CODES['down']] = Fn.partial(climb, 'down');
	movements[Keys.CODES['left']] = Fn.partial(step, 'left');
	movements[Keys.CODES['right']] = Fn.partial(step, 'right');
	movements[Keys.CODES['pageUp']] =
	movements['meta+' + Keys.CODES['up']] = Fn.partial(jump, 'up');
	movements[Keys.CODES['pageDown']] =
	movements['meta+' + Keys.CODES['down']] = Fn.partial(jump, 'down');

	/**
	 * Processes a keypress event.
	 *
	 * @private
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function keypress(event, range, focus) {
		return {
			range: range,
			focus: focus
		};
	}

	/**
	 * Processes a keydown event.
	 *
	 * @private
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function keydown(event, range, focus) {
		var meta = event.meta.indexOf('meta') > -1;
		if (meta && movements['meta+' + event.keycode]) {
			return movements['meta+' + event.keycode](event, range, focus);
		}
		return (movements[event.keycode] || keypress)(event, range, focus);
	}

	/**
	 * Processes a double-click event.
	 *
	 * @private
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function dblclick(event, range, focus, previous, expanding) {
		var boundaries = Boundaries.fromRange(range);
		boundaries = Traversing.expand(boundaries[0], boundaries[1], 'word');
		return {
			range: Boundaries.range(boundaries[0], boundaries[1]),
			focus: 'end'
		};
	}

	function tplclick(event, range, focus) {
		var boundaries = Boundaries.fromRange(range);
		boundaries = Traversing.expand(boundaries[0], boundaries[1], 'block');
		return {
			range: Boundaries.range(boundaries[0], boundaries[1]),
			focus: 'end'
		};
	}

	/**
	 * Processes a mouseup event.
	 *
	 * @private
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function mouseup(event, range, focus, previous, expanding) {
		if (!expanding) {
			return {
				range: range,
				focus: focus
			};
		}
		return mergeRanges(range, previous, focus);
	}

	/**
	 * Processes a mousedown event.
	 *
	 * @private
	 * @param  {Event}  event
	 * @param  {Range}  range
	 * @param  {string} focus
	 * @return {Object}
	 */
	function mousedown(event, range, focus, previous, expanding) {
		if (!expanding) {
			return {
				range: range,
				focus: focus
			};
		}
		var sc = range.startContainer;
		var so = range.startOffset;
		var ec, eo, current;
		if ('start' === focus) {
			ec = previous.endContainer;
			eo = previous.endOffset;
		} else {
			ec = previous.startContainer;
			eo = previous.startOffset;
		}
		if (isReversed(sc, so, ec, eo)) {
			focus = 'end';
			current = Ranges.create(ec, eo, sc, so);
		} else {
			focus = 'start';
			current = Ranges.create(sc, so, ec, eo);
		}
		return {
			range: current,
			focus: focus
		};
	}

	function dragndrop(event, range) {
		return {
			range: range,
			focus: 'end'
		};
	}

	function resize(event, range, focus) {
		return {
			range: range,
			focus: focus
		};
	}

	function paste(event, range, focus) {
		return {
			range: Boundaries.range(event.selection.boundaries[0], event.selection.boundaries[1]),
			focus: 'end'
		};
	}

	/**
	 * Event handlers.
	 *
	 * @private
	 * @type {Object.<string, function>}
	 */
	var handlers = {
		'keydown'   : keydown,
		'keypress'  : keypress,
		'dblclick'  : dblclick,
		'tplclick'  : tplclick,
		'mouseup'   : mouseup,
		'mousedown' : mousedown,
		'mousemove' : Fn.returnFalse,
		'dragover'  : dragndrop,
		'drop'      : dragndrop,
		'resize'    : resize,
		'paste'     : paste
	};

	/**
	 * Initialize blinking using the given element.
	 *
	 * @private
	 * @param  {Element} caret
	 * @return {Object}
	 */
	function blinking(caret) {
		var timers = [];
		var isBlinking = true;
		function fade(start, end, duration) {
			Animation.animate(
				start,
				end,
				Animation.easeLinear,
				duration,
				function (value, percent, state) {
					if (!isBlinking) {
						return true;
					}
					Dom.setStyle(caret, 'opacity', value);
					if (percent < 1) {
						return;
					}
					if (0 === value) {
						timers.push(setTimeout(function () {
							fade(0, 1, 100);
						}, 300));
					} else if (1 === value){
						timers.push(setTimeout(function () {
							fade(1, 0, 100);
						}, 500));
					}
				}
			);
		}
		function stop() {
			isBlinking = false;
			Dom.setStyle(caret, 'opacity', 1);
			timers.forEach(clearTimeout);
			timers = [];
		}
		function blink() {
			stop();
			isBlinking = true;
			timers.push(setTimeout(function () {
				fade(1, 0, 100);
			}, 500));
		}
		function start() {
			stop();
			timers.push(setTimeout(blink, 50));
		}
		return {
			start : start,
			stop  : stop
		};
	}

	/**
	 * Creates a new selection context.
	 *
	 * Will create a DOM element at the end of the document body to be used to
	 * represent the caret position.
	 *
	 * @param  {Document} doc
	 * @return {Object}
	 */
	function Context(doc) {
		var caret = doc.createElement('div');
		Maps.extend(caret.style, {
			'color'    : '#000',
			'zIndex'   : '9999',
			'display'  : 'none',
			'position' : 'absolute'
		});
		Dom.addClass(caret, 'aloha-caret', 'aloha-ephemera');
		Dom.insert(caret, doc.body, true);
		return {
			blinking   : blinking(caret),
			focus      : 'end',
			boundaries : null,
			event      : null,
			caret      : caret,
			clickTimer : 0,
			formatting : [],
			overrides  : []
		};
	}

	/**
	 * Ensures that the given boundary is visible inside of the viewport by
	 * scolling the view port if necessary.
	 *
	 * @param {!Boundary} boundary
	 */
	function focus(boundary) {
		var box = Carets.box(Boundaries.range(boundary, boundary));
		var doc = Boundaries.document(boundary);
		var win = Dom.documentWindow(doc);
		var top = win.pageYOffset - doc.body.clientTop;
		var left = win.pageXOffset - doc.body.clientLeft;
		var height = win.innerHeight;
		var width = win.innerWidth;
		var buffer = box.height;
		var caretTop = box.top;
		var caretLeft = box.left;
		var correctTop = 0;
		var correctLeft = 0;
		if (caretTop < top) {
			// Because we want to caret to be near the top
			correctTop = caretTop - buffer;
		} else if (caretTop > top + height) {
			// Because we want to caret to be near the bottom
			correctTop = caretTop - height + buffer + buffer;
		}
		if (caretLeft < left) {
			// Because we want to caret to be near the left
			correctLeft = caretLeft - buffer;
		} else if (caretLeft > left + width) {
			// Because we want to caret to be near the right
			correctLeft = caretLeft - width + buffer + buffer;
		}
		if (correctTop || correctLeft) {
			win.scrollTo(correctLeft || left, correctTop || top);
		}
	}

	/**
	 * Joins a variable list of overrides-lists into a single unique set.
	 *
	 * @private
	 * @param  {Array.<Override>...}
	 * @param  {Array.<Override>}
	 */
	function joinToSet() {
		return Overrides.unique(
			Array.prototype.concat.apply([], Arrays.coerce(arguments))
		);
	}

	/**
	 * Computes a table of the given override and those collected at the given
	 * node.
	 *
	 * An object with overrides mapped against their names
	 *
	 * @private
	 * @param  {Node}             node
	 * @param  {SelectionContext} context
	 * @return {Object}
	 */
	function mapOverrides(node, context) {
		var overrides = joinToSet(
			context.formatting,
			Overrides.harvest(node),
			context.overrides
		);
		var map = Maps.merge(Maps.mapTuples(overrides));
		if (!map['color']) {
			map['color'] = Dom.getComputedStyle(
				Dom.isTextNode(node) ? node.parentNode : node,
				'color'
			);
		}
		return map;
	}

	/**
	 * Updates selection
	 *
	 * @param  {AlohaEvent} event
	 * @return {AlohaEvent}
	 */
	function handleSelections(event) {
		if (!handlers[event.type]) {
			return event;
		}
		var selection = event.selection;
		var change = handlers[event.type](
			event,
			Boundaries.range(selection.boundaries[0], selection.boundaries[1]),
			selection.focus,
			selection.range,
			Events.hasKeyModifier(event, 'shift')
		);
		selection.focus = change.focus;
		selection.boundaries = Boundaries.fromRange(change.range);
		// Because we don't want the page to scroll
		if ('keydown' === event.type && movements[event.keycode]) {
			Events.preventDefault(event.nativeEvent);
		}
		return event;
	}

	/**
	 * Whether the given event will cause the position of the selection to move.
	 *
	 * @private
	 * @param  {Event} event
	 * @return {boolean}
	 */
	function isCaretMovingEvent(event) {
		if ('keypress' === event.type) {
			return true;
		}
		if ('paste' === event.type) {
			return true;
		}
		if (Keys.ARROWS[event.keycode]) {
			return true;
		}
		if (Keys.CODES['pageDown'] === event.keycode || Keys.CODES['pageUp'] === event.keycode) {
			return true;
		}
		if (Keys.CODES['undo'] === event.keycode) {
			if ('meta' === event.meta || 'ctrl' === event.meta || 'shift' === event.meta) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Causes the selection for the given event to be set to the browser and the
	 * caret position to be visualized.
	 *
	 * @param {AlohaEvent} event
	 */
	function update(event) {
		if (event.preventSelection) {
			return;
		}
		if ('click' === event.type
				|| ('dblclick' === event.type && 'dblclick' === event.nativeEvent.type)) {
			Dom.setStyle(event.selection.caret, 'display', 'block');
			return;
		}
		var boundary = select(
			event.selection,
			event.selection.boundaries[0],
			event.selection.boundaries[1],
			event.selection.focus
		);
		// Because we don't want the screen to jump when the editor hits "shift"
		if (isCaretMovingEvent(event)) {
			focus(boundary);
		}
	}

	/**
	 * Selects the given boundaries and visualizes the caret position.
	 *
	 * Returns the focus boundary so that one can do focus(select(...))
	 *
	 * @param  {Context}  selection
	 * @param  {Boundary} start
	 * @param  {Boundary} end
	 * @param  {string=}  focus optional. "start" or "end". Defaults to "end"
	 * @return {Boundary}
	 */
	function select(selection, start, end, focus) {
		var boundary = 'start' === focus ? start : end;
		var node = Boundaries.container(boundary);
		if (!Dom.isEditableNode(node)) {
			Dom.setStyle(selection.caret, 'display', 'none');
			return boundary;
		}
		show(selection.caret, boundary);
		Maps.extend(
			selection.caret.style,
			stylesFromOverrides(mapOverrides(node, selection))
		);
		Boundaries.select(start, end);
		selection.blinking.start();
		return boundary;
	}

	return {
		show             : show,
		select           : select,
		focus            : focus,
		update           : update,
		handleSelections : handleSelections,
		Context          : Context,
		hideCarets       : hideCarets,
		unhideCarets     : unhideCarets
	};
});
