import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCopy } from './renderer-language';
import type { Task } from './workspace-api';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const drawerLimits = () => {
  const max = Math.min(760, document.documentElement.clientWidth);
  return { min: Math.min(340, max), max };
};
const bounded = (width: number) => {
  const { min, max } = drawerLimits();
  return Math.round(Math.max(min, Math.min(max, width)));
};

export function DrawerResize({ panel, active }: { panel: RefObject<HTMLDialogElement | null>; active: boolean }) {
  const t = useCopy();
  const handle = useRef<HTMLDivElement>(null);
  const requested = useRef(408);
  const frame = useRef(0);
  const drag = useRef<{ id: number; x: number; start: number; next: number } | null>(null);
  const [range, setRange] = useState(() => ({ ...drawerLimits(), width: bounded(requested.current) }));
  function apply(width: number) {
    const next = bounded(width);
    panel.current?.style.setProperty('--drawer-width', `${next}px`);
    setRange({ ...drawerLimits(), width: next });
  }
  function finish() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    panel.current?.classList.remove('is-resizing');
    if (handle.current?.hasPointerCapture(current.id)) handle.current.releasePointerCapture(current.id);
    requested.current = bounded(current.next);
    apply(requested.current);
  }
  useLayoutEffect(() => {
    if (!active) { finish(); return; }
    function resize() { finish(); apply(requested.current); }
    window.addEventListener('resize', resize);
    window.addEventListener('blur', finish);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', finish);
    };
  }, [active]);
  return <div ref={handle} className="drawer-resize" role="separator" aria-label={t.drawerWidth} title={t.drawerWidth}
    aria-controls="task-drawer-body" aria-orientation="vertical" aria-valuemin={range.min} aria-valuemax={range.max}
    aria-valuenow={range.width} aria-valuetext={t.pixelWidth(range.width)} tabIndex={active ? 0 : -1} hidden={range.min === range.max}
    onPointerDown={event => {
      if (!active || !event.isPrimary || event.button !== 0 || drag.current || !panel.current) return;
      // Resizing with the mouse must not take focus from an editing field.
      event.preventDefault();
      const width = panel.current.offsetWidth;
      drag.current = { id: event.pointerId, x: event.clientX, start: width, next: width };
      event.currentTarget.setPointerCapture(event.pointerId);
      panel.current.classList.add('is-resizing');
    }} onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.next = current.start + current.x - event.clientX;
      if (!frame.current) frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (drag.current) apply(drag.current.next);
      });
    }} onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current.next = drag.current.start + drag.current.x - event.clientX;
      finish();
    }} onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      const step = event.shiftKey ? 48 : 16;
      const { min, max } = drawerLimits();
      const next = event.key === 'ArrowLeft' ? range.width + step : event.key === 'ArrowRight' ? range.width - step
        : event.key === 'Home' ? min : event.key === 'End' ? max : null;
      if (next === null || !active || drag.current) return;
      event.preventDefault();
      requested.current = bounded(next);
      apply(requested.current);
    }} />;
}

type Drag = {
  id: number; item: HTMLElement; task: Task; board: HTMLElement; scroll: HTMLElement; outer: HTMLElement;
  x: number; y: number; dx: number; dy: number; width: number;
  target: HTMLElement | null; ghost?: HTMLElement; frame: number; frameTime: number;
  started: () => void; drop: (statusId: number | null) => Promise<boolean>;
};

// The usable scrollport excludes scrollbars and the portion clipped by the short-window workspace.
function scrollport(drag: Drag) {
  const s = drag.scroll.getBoundingClientRect();
  const parent = drag.outer.getBoundingClientRect();
  return {
    left: Math.max(0, s.left, parent.left), top: Math.max(0, s.top, parent.top),
    right: Math.min(innerWidth, s.left + drag.scroll.clientWidth, parent.left + drag.outer.clientWidth),
    bottom: Math.min(innerHeight, s.top + drag.scroll.clientHeight, parent.top + drag.outer.clientHeight),
  };
}
function edgeSpeed(point: number, first: number, last: number) {
  const zone = Math.min(40, (last - first) / 2);
  if (point < first || point >= last || zone <= 0) return 0;
  const depth = Math.max(0, 1 - (last - point) / zone) - Math.max(0, 1 - (point - first) / zone);
  return depth * 820;
}

export function useCardDrag(context: string, started: () => void) {
  const gesture = useRef<Drag | null>(null);
  const cleanupGhost = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  function targetAt(drag: Drag, x: number, y: number) {
    const bounds = scrollport(drag);
    if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null;
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.column[data-status-id]') ?? null;
    return target && drag.board.contains(target) && Number(target.dataset.statusId) !== drag.task.statusId ? target : null;
  }
  function highlight(drag: Drag, target: HTMLElement | null) {
    if (drag.target === target) return;
    drag.target?.classList.remove('drop-target');
    target?.classList.add('drop-target');
    drag.target = target;
  }
  function moveGhost(ghost: HTMLElement, x: number, y: number) {
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  function stop(drag: Drag) {
    gesture.current = null;
    cancelAnimationFrame(drag.frame);
    highlight(drag, null);
    if (drag.ghost) suppressClick.current = true;
    if (drag.item.hasPointerCapture(drag.id)) drag.item.releasePointerCapture(drag.id);
    document.body.classList.remove('card-dragging');
  }
  useLayoutEffect(() => () => {
    if (gesture.current) stop(gesture.current);
    cleanupGhost.current?.();
  }, [context]);
  useLayoutEffect(() => {
    function refreshTarget(drag: Drag) {
      highlight(drag, targetAt(drag, drag.x, drag.y));
    }
    function scheduleEdge(drag: Drag) {
      if (drag.frame || !drag.ghost) return;
      const bounds = scrollport(drag);
      const { x, y, scroll, outer } = drag;
      if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) { drag.frameTime = 0; return; }
      const dx = edgeSpeed(x, bounds.left, bounds.right);
      const dy = edgeSpeed(y, bounds.top, bounds.bottom);
      const canScroll = (speed: number, position: number, max: number) => speed < 0 ? position > 0 : speed > 0 && position < max - 0.5;
      const canScrollY = (el: HTMLElement) => canScroll(dy, el.scrollTop, el.scrollHeight - el.clientHeight);
      const horizontal = canScroll(dx, scroll.scrollLeft, scroll.scrollWidth - scroll.clientWidth);
      const vertical = canScrollY(scroll) ? scroll : canScrollY(outer) ? outer : null;
      if (!horizontal && !vertical) { drag.frameTime = 0; return; }
      drag.frame = requestAnimationFrame(now => {
        drag.frame = 0;
        if (gesture.current !== drag || !drag.item.isConnected || !drag.board.isConnected) return;
        const dt = Math.min(drag.frameTime ? now - drag.frameTime : 16, 32) / 1000;
        drag.frameTime = now;
        // Fractional scrolls may round to zero; move at least one CSS px when in the zone.
        const step = (speed: number) => Math.sign(speed) * Math.max(1, Math.abs(speed) * dt);
        scroll.scrollBy({ left: horizontal ? step(dx) : 0, top: vertical === scroll ? step(dy) : 0, behavior: 'instant' });
        if (vertical === outer) outer.scrollBy({ top: step(dy), behavior: 'instant' });
        refreshTarget(drag);
        scheduleEdge(drag);
      });
    }
    function scrolled(event: Event) {
      const drag = gesture.current;
      if (!drag?.ghost || (event.target !== drag.scroll && event.target !== drag.outer)) return;
      refreshTarget(drag);
      scheduleEdge(drag);
    }
    function move(event: PointerEvent) {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      if (event.clientX < 0 || event.clientY < 0 || event.clientX >= innerWidth || event.clientY >= innerHeight ||
        !(event.buttons & 1) || !drag.item.isConnected) { finish(event, true); return; }
      if (!drag.ghost) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        const ghost = drag.item.cloneNode(true) as HTMLElement;
        ghost.classList.add('card-ghost');
        ghost.removeAttribute('data-task-id');
        ghost.querySelectorAll('[id], [popover], .status-button').forEach(node => {
          if (node.matches('[popover], .status-button')) node.remove();
          else node.removeAttribute('id');
        });
        ghost.inert = true;
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.width = `${drag.width}px`;
        document.body.append(ghost);
        drag.ghost = ghost;
        drag.item.setPointerCapture(drag.id);
        drag.started();
        drag.item.classList.add('card-source');
        document.body.classList.add('card-dragging');
        cleanupGhost.current = () => {
          ghost.remove();
          drag.item.classList.remove('card-source');
          cleanupGhost.current = null;
        };
      }
      event.preventDefault();
      drag.x = event.clientX;
      drag.y = event.clientY;
      moveGhost(drag.ghost, drag.x - drag.dx, drag.y - drag.dy);
      refreshTarget(drag);
      cancelAnimationFrame(drag.frame);
      drag.frame = 0;
      scheduleEdge(drag);
    }
    function finish(event?: PointerEvent, cancelled = false) {
      const drag = gesture.current;
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const target = !cancelled && event && drag.ghost ? targetAt(drag, event.clientX, event.clientY) : null;
      stop(drag);
      const ghost = drag.ghost;
      const remove = cleanupGhost.current;
      if (!ghost || !remove) return;
      const settle = (success: boolean) => {
        // A newer gesture or view change may have removed this ghost during the write.
        if (!ghost.isConnected) return;
        const targetCard = success ? target?.querySelector<HTMLElement>(`[data-task-id="${drag.task.id}"]`) : drag.item;
        const box = targetCard?.getBoundingClientRect();
        const clip = drag.board.parentElement?.getBoundingClientRect();
        if (reduce() || !box?.width || !clip || box.bottom <= clip.top || box.top >= clip.bottom ||
          box.right <= clip.left || box.left >= clip.right) { remove(); return; }
        ghost.classList.add('card-settling');
        moveGhost(ghost, box.left, box.top);
        const ended = () => { if (ghost.isConnected) remove(); };
        ghost.addEventListener('transitionend', ended, { once: true });
        ghost.addEventListener('transitioncancel', ended, { once: true });
        window.setTimeout(ended, 210);
      };
      if (!target) {
        void drag.drop(null);
        settle(false);
      } else {
        void drag.drop(Number(target.dataset.statusId)).then(success => {
          // Let React place the committed card before measuring its destination.
          requestAnimationFrame(() => requestAnimationFrame(() => settle(success)));
        });
      }
    }
    const release = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    const blur = () => finish(undefined, true);
    const exit = (event: PointerEvent) => { if (!event.relatedTarget) cancel(event); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current?.ghost) { event.preventDefault(); blur(); }
    };
    // Captured gestures do not emit pointerout on leaving the window; pointerup still checks the hit target.
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('lostpointercapture', cancel);
    window.addEventListener('pointerout', exit);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('scroll', scrolled, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('pointerout', exit);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, []);
  return {
    begin(event: ReactPointerEvent<HTMLElement>, task: Task, drop: Drag['drop']) {
      if (!event.isPrimary || event.button !== 0 || gesture.current) return;
      suppressClick.current = false;
      const item = event.currentTarget;
      if (!(event.target instanceof HTMLElement) || event.target.closest('.status-button, .status-menu')) return;
      if (event.pointerType === 'touch' && !event.target.closest('.card-grip')) return;
      const board = item.closest<HTMLElement>('.board');
      const scroll = board?.parentElement;
      const outer = scroll?.closest<HTMLElement>('.workspace');
      if (!board || !scroll || !outer) return;
      cleanupGhost.current?.();
      const { left, top, width } = item.getBoundingClientRect();
      const { clientX: x, clientY: y } = event;
      gesture.current = { id: event.pointerId, item, task, board, scroll, outer, x, y, dx: x - left, dy: y - top,
        width, target: null, frame: 0, frameTime: 0, started, drop };
    },
    consumeClick(detail: number) {
      if (!detail || !suppressClick.current) return false;
      suppressClick.current = false;
      return true;
    },
  };
}
