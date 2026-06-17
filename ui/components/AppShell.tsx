import { Box, Fixed, Row, Screen, Text } from "@valyrianjs/terminal";
import type { AppShellOptions } from "../types";

const TOP_NAV_BOTTOM_MARGIN_ROWS = 1;

export function createAppShell(options: AppShellOptions): JSX.Element {
  const {
    activePanelNodes,
    actionBar,
    boardActionBar,
    children = [],
    footerText,
    footerSegments,
    footerStyle,
    panelHeight,
    panelStyle,
    topNav,
    width
  } = options;
  const bottomActionBar = actionBar ?? boardActionBar;
  const bottomChromeSize = bottomActionBar ? 3 : 1;

  return (
    <Screen>
      {topNav}
      {TOP_NAV_BOTTOM_MARGIN_ROWS > 0 ? <Text>{""}</Text> : null}
      <Box width={width} height={panelHeight} style={panelStyle}>
        {activePanelNodes}
      </Box>
      <Fixed position="bottom" size={bottomChromeSize}>
        {bottomActionBar}
        {Array.isArray(footerSegments) && footerSegments.length > 0 ? (
          <Row separator="  ">
            {footerSegments.map((segment, index) => (
              <Text key={`footer-${index}`} style={segment.style ?? footerStyle}>{segment.text}</Text>
            ))}
          </Row>
        ) : (
          <Text style={footerStyle}>{footerText}</Text>
        )}
      </Fixed>
      {children}
    </Screen>
  );
}
