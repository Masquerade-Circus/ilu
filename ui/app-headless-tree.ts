import type { TerminalElementNode, TerminalNode, TerminalSession } from "@valyrianjs/terminal";

function isTerminalElementNode(node: TerminalNode): node is TerminalElementNode {
  return node.type === "element";
}

export function findFocusedNode(nodes: TerminalNode[]): TerminalElementNode | null {
  for (const node of nodes) {
    if (!isTerminalElementNode(node)) {
      continue;
    }

    if (node.props.__focused) {
      return node;
    }

    const child = findFocusedNode(node.children);

    if (child) {
      return child;
    }
  }

  return null;
}

export function findNodeById(nodes: TerminalNode[], id: string | null | undefined): TerminalElementNode | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (!isTerminalElementNode(node)) {
      continue;
    }

    if (node.props.id === id) {
      return node;
    }

    const child = findNodeById(node.children, id);

    if (child) {
      return child;
    }
  }

  return null;
}

export function isFocusedTextEntry(node: TerminalElementNode | null): boolean {
  return node?.tag === "terminal-input" || node?.tag === "terminal-editor";
}

export function pasteTextIntoFocusedEntry(session: TerminalSession, text: string): string {
  const previousClipboard = session.clipboard();

  session.setClipboard(text);
  const output = session.dispatchKey("CTRL_V");
  session.setClipboard(previousClipboard);
  return output;
}

export default {
  findFocusedNode,
  findNodeById,
  isFocusedTextEntry,
  pasteTextIntoFocusedEntry
};
