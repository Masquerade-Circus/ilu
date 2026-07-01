import { Fixed, Overlay, Pane } from "@valyrianjs/terminal";
import type { TerminalOverlayProps, TerminalStyleValue } from "@valyrianjs/terminal";
import { OVERLAY_STYLE, OVERLAY_SURFACE_STYLE } from "../theme";

export { OVERLAY_STYLE, OVERLAY_SURFACE_STYLE };

type OverlaySlot = JSX.Element | JSX.Element[] | null;

type OverlaySurfaceOptions = {
  width?: number;
  height?: number;
  style?: TerminalStyleValue;
  surfaceStyle?: TerminalStyleValue;
};

type OverlayRuntimeState = {
  activeOverlay: string | null;
};

export type AppOverlayProps = Partial<TerminalOverlayProps> & OverlaySurfaceOptions & {
  title?: OverlaySlot;
  topNav?: OverlaySlot;
  content?: OverlaySlot;
  bottomNav?: OverlaySlot;
};

export function createOverlayProps(props: Partial<TerminalOverlayProps> = {}): TerminalOverlayProps {
  const style: TerminalStyleValue = props.style ?? OVERLAY_STYLE;
  const margin = props.margin ?? { x: "10%", y: "10%" };
  const trapFocus = props.trapFocus ?? true;
  const backdrop = props.backdrop ?? true;

  return { ...props, margin, style, trapFocus, backdrop };
}

export function hasActiveOverlay(state: OverlayRuntimeState): boolean {
  return state.activeOverlay !== null;
}

export function closeActiveOverlay(state: OverlayRuntimeState): boolean {
  if (!hasActiveOverlay(state)) {
    return false;
  }

  state.activeOverlay = null;
  return true;
}

export function createOverlaySurface(...children: Array<JSX.Element | null>): JSX.Element {
  return createOverlaySurfaceFrame({}, ...children);
}

export function createOverlaySurfaceFrame(options: OverlaySurfaceOptions, ...children: Array<JSX.Element | null>): JSX.Element {
  const { width, height, style = OVERLAY_SURFACE_STYLE } = options;

  return <Pane width={width} height={height} fill={true} style={style}>{children}</Pane>;
}

function slotNodes(slot: OverlaySlot | undefined): JSX.Element[] {
  if (Array.isArray(slot)) {
    return slot.filter((node: JSX.Element | null): node is JSX.Element => node !== null);
  }

  return slot === null || typeof slot === "undefined" ? [] : [slot];
}

export function AppOverlay(props: AppOverlayProps): JSX.Element {
  const {
    title = null,
    topNav = null,
    content = null,
    bottomNav = null,
    width,
    height,
    surfaceStyle = OVERLAY_SURFACE_STYLE,
    ...overlayProps
  } = props;
  const titleNodes = slotNodes(title);
  const topNavNodes = slotNodes(topNav);
  const contentNodes = slotNodes(content);
  const bottomNavNodes = slotNodes(bottomNav);
  const topSize = titleNodes.length + topNavNodes.length;
  const bottomSize = bottomNavNodes.length;

  return (
    <Overlay {...createOverlayProps(overlayProps)}>
      {createOverlaySurfaceFrame(
        { width, height, style: surfaceStyle },
        topSize > 0 ? (
          <Fixed position="top" size={topSize}>
            {titleNodes}
            {topNavNodes}
          </Fixed>
        ) : null,
        <Pane fill={true}>{contentNodes}</Pane>,
        bottomSize > 0 ? (
          <Fixed position="bottom" size={bottomSize}>
            {bottomNavNodes}
          </Fixed>
        ) : null
      )}
    </Overlay>
  );
}
