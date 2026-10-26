import type { WebGalCommandType, WebGalNode } from './webgal-types';

const TERMINAL_TYPES = new Set<WebGalCommandType>(['choose', 'changeScene', 'end', 'jumpLabel']);

function isTerminalNode(type: WebGalCommandType): boolean {
  return TERMINAL_TYPES.has(type);
}

function reconnectSequentialNodes(nodes: WebGalNode[]): WebGalNode[] {
  return nodes.map((node, index) => {
    const next = nodes[index + 1];
    const connections = next && !isTerminalNode(node.type) ? [next.id] : [];
    if (
      connections.length === node.connections.length
      && connections.every((connection, connectionIndex) => connection === node.connections[connectionIndex])
    ) {
      return node;
    }
    return { ...node, connections };
  });
}

function defaultPosition(index: number) {
  return { x: 100, y: 60 + index * 110 };
}

function createSceneNode(type: WebGalCommandType, id: string, index: number): WebGalNode {
  const node: WebGalNode = {
    id,
    type,
    content: '',
    flags: [],
    position: defaultPosition(index),
    connections: [],
  };
  if (type === 'dialogue') node.character = '';
  if (type === 'choose') node.choices = [{ text: '选项 1', target: '' }];
  if (type === 'intro') node.introLines = [''];
  if (type === 'setVar') {
    node.varName = '';
    node.varValue = '';
  }
  return node;
}

export function insertSceneNode(
  nodes: WebGalNode[],
  type: WebGalCommandType,
  atIndex: number,
  id: string,
): { nodes: WebGalNode[]; inserted: WebGalNode } {
  const index = Math.max(0, Math.min(atIndex, nodes.length));
  const inserted = createSceneNode(type, id, index);
  const next = reconnectSequentialNodes([...nodes.slice(0, index), inserted, ...nodes.slice(index)]);
  return {
    nodes: next,
    inserted: next.find((node) => node.id === id) ?? inserted,
  };
}

export function pasteSceneNode(
  nodes: WebGalNode[],
  clipboardNode: WebGalNode,
  atIndex: number,
  id: string,
): WebGalNode[] {
  const index = Math.max(0, Math.min(atIndex + 1, nodes.length));
  const inserted: WebGalNode = {
    ...clipboardNode,
    id,
    position: defaultPosition(index),
  };
  return reconnectSequentialNodes([...nodes.slice(0, index), inserted, ...nodes.slice(index)]);
}

export function reorderSceneNodes(
  nodes: WebGalNode[],
  fromIndex: number,
  toIndex: number,
): WebGalNode[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= nodes.length) return nodes;
  const clampedTo = Math.max(0, Math.min(toIndex, nodes.length - 1));
  if (fromIndex === clampedTo) return nodes;
  const moved = [...nodes];
  const [node] = moved.splice(fromIndex, 1);
  moved.splice(clampedTo, 0, node);
  return reconnectSequentialNodes(moved);
}
