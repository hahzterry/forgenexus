<script lang="ts">
  import { canvasState } from './canvas-state.svelte';
  import { screenToCanvas, getOutputPortPosition, getPortIndexByName } from './canvas-math';
  import CanvasNode from './CanvasNode.svelte';
  import CanvasEdge from './CanvasEdge.svelte';
  import EdgeDraft from './EdgeDraft.svelte';

  let svgEl = $state<SVGSVGElement | null>(null);

  // Drag state
  let isDraggingNode = $state(false);
  let dragNodeId = $state<string | null>(null);
  let dragOffset = $state({ x: 0, y: 0 });

  // Pan state
  let isPanning = $state(false);
  let panStart = $state({ x: 0, y: 0 });
  let spaceHeld = $state(false);

  function getCanvasCoords(e: MouseEvent) {
    if (!svgEl) return { x: 0, y: 0 };
    const rect = svgEl.getBoundingClientRect();
    return screenToCanvas(e.clientX, e.clientY, canvasState.viewport.panX, canvasState.viewport.panY, canvasState.viewport.zoom, rect);
  }

  function handleWheel(e: WheelEvent) {
    if ((e.target as HTMLElement).closest('.canvas-keyboard-tools')) return;
    e.preventDefault();
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    canvasState.zoomTo(canvasState.viewport.zoom * factor, pivotX, pivotY);
  }

  function handleMouseDown(e: MouseEvent) {
    if (!svgEl) return;
    // Middle mouse or space+left for pan
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      return;
    }
    // Left click on empty canvas → clear selection
    if (e.button === 0 && e.target === svgEl) {
      canvasState.clearSelection();
      canvasState.cancelDraftEdge();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      canvasState.pan(dx, dy);
      panStart = { x: e.clientX, y: e.clientY };
      return;
    }

    if (isDraggingNode && dragNodeId) {
      const pos = getCanvasCoords(e);
      canvasState.moveNode(dragNodeId, pos.x - dragOffset.x, pos.y - dragOffset.y);
      return;
    }

    if (canvasState.draftEdge) {
      const pos = getCanvasCoords(e);
      canvasState.updateDraftEdge(pos.x, pos.y);
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (isPanning) {
      isPanning = false;
      return;
    }
    if (isDraggingNode) {
      isDraggingNode = false;
      dragNodeId = null;
      return;
    }
    if (canvasState.draftEdge) {
      canvasState.cancelDraftEdge();
    }
  }

  function handleNodeMouseDown(nodeId: string, e: MouseEvent) {
    if (spaceHeld) return; // let pan take over
    e.stopPropagation();
    canvasState.selectNode(nodeId);
    const pos = getCanvasCoords(e);
    const node = canvasState.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    isDraggingNode = true;
    dragNodeId = nodeId;
    dragOffset = { x: pos.x - node.position_x, y: pos.y - node.position_y };
  }

  function handleStartDraft(nodeId: string, port: string, absX: number, absY: number) {
    canvasState.startDraftEdge(nodeId, port, absX, absY);
  }

  function handleCompleteDraft(nodeId: string, port: string) {
    canvasState.completeDraftEdge(nodeId, port);
  }

  function handleEdgeSelect(edgeId: string) {
    canvasState.selectEdge(edgeId);
  }

  const canvasId = $props.id();

  // Keyboard
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[e.key]) {
      e.preventDefault();
      const [dx, dy] = directions[e.key];
      const step = e.shiftKey ? 20 : 5;
      const node = canvasState.selectedNode;
      if (node) canvasState.moveNode(node.id, node.position_x + dx * step, node.position_y + dy * step);
      else canvasState.pan(dx * step, dy * step);
    }
    if (e.key === 'Escape') { canvasState.clearSelection(); canvasState.cancelDraftEdge(); }
    if (e.key === '+' || e.key === '-') {
      e.preventDefault();
      const rect = svgEl?.getBoundingClientRect();
      if (rect) canvasState.zoomTo(canvasState.viewport.zoom * (e.key === '+' ? 1.1 : 1 / 1.1), rect.width / 2, rect.height / 2);
    }
    if (e.code === 'Space') {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      spaceHeld = true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete if user is typing in an input
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      canvasState.deleteSelected();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spaceHeld = false;
    }
  }

  // Draft edge source position
  function getDraftSourcePos() {
    if (!canvasState.draftEdge) return { x: 0, y: 0 };
    const node = canvasState.nodes.find((n) => n.id === canvasState.draftEdge!.sourceNodeId);
    if (!node) return { x: 0, y: 0 };
    const schema = canvasState.nodeTypeMap.get(node.type);
    if (!schema) return { x: node.position_x + 200, y: node.position_y + 52 };
    const portIdx = getPortIndexByName(schema, 'output', canvasState.draftEdge!.sourcePort);
    return getOutputPortPosition(node, portIdx);
  }

  function moveSelection(dx: number, dy: number) {
    const node = canvasState.selectedNode;
    if (node) canvasState.moveNode(node.id, node.position_x + dx, node.position_y + dy);
    else canvasState.pan(dx, dy);
  }

  function interact(node: HTMLDivElement) {
    node.addEventListener('mousedown', handleMouseDown);
    node.addEventListener('mousemove', handleMouseMove);
    node.addEventListener('mouseup', handleMouseUp);
    node.addEventListener('wheel', handleWheel, { passive: false });
    node.addEventListener('keydown', handleKeyDown);
    return { destroy() {
      node.removeEventListener('mousedown', handleMouseDown);
      node.removeEventListener('mousemove', handleMouseMove);
      node.removeEventListener('mouseup', handleMouseUp);
      node.removeEventListener('wheel', handleWheel);
      node.removeEventListener('keydown', handleKeyDown);
    } };
  }

  function zoom(factor: number) {
    const rect = svgEl?.getBoundingClientRect();
    if (rect) canvasState.zoomTo(vp.zoom * factor, rect.width / 2, rect.height / 2);
  }

  const vp = $derived(canvasState.viewport);
</script>

<svelte:window onkeyup={handleKeyUp} />

<div class="canvas-interaction" role="group" aria-label="Flow editor" aria-describedby={`${canvasId}-instructions`} use:interact>
  <span class="canvas-instructions" id={`${canvasId}-instructions`}>Choose a node, then use the direction controls to move it. With no selection, they pan the canvas. Arrow keys on the direction controls also move or pan; plus and minus zoom; Delete removes the selection; Escape clears it.</span>
  <div class="canvas-keyboard-tools">
    <select aria-label="Select flow node" value={canvasState.selectedNodeId ?? ''} onchange={(event) => canvasState.selectNode(event.currentTarget.value || null)}>
      <option value="">Pan canvas (no selection)</option>
      {#each canvasState.nodes as node (node.id)}<option value={node.id}>{node.label || node.type}</option>{/each}
    </select>
    <div class="canvas-direction-controls" role="group" aria-label={canvasState.selectedNode ? 'Move selected node' : 'Pan canvas'}>
      <button type="button" aria-label="Move left" onclick={() => moveSelection(-5, 0)}>←</button>
      <button type="button" aria-label="Move up" onclick={() => moveSelection(0, -5)}>↑</button>
      <button type="button" aria-label="Move down" onclick={() => moveSelection(0, 5)}>↓</button>
      <button type="button" aria-label="Move right" onclick={() => moveSelection(5, 0)}>→</button>
      <button type="button" aria-label="Zoom in" onclick={() => zoom(1.1)}>+</button>
      <button type="button" aria-label="Zoom out" onclick={() => zoom(1 / 1.1)}>−</button>
      <button type="button" aria-label="Delete selection" disabled={!canvasState.selectedNodeId && !canvasState.selectedEdgeId} onclick={() => canvasState.deleteSelected()}>Delete</button>
    </div>
    <output aria-live="polite">{canvasState.selectedNode ? `${canvasState.selectedNode.label || canvasState.selectedNode.type}: ${canvasState.selectedNode.position_x}, ${canvasState.selectedNode.position_y}` : `Zoom ${Math.round(vp.zoom * 100)}%`}</output>
  </div>
<svg
  bind:this={svgEl}
  class="canvas-svg"
  role="img"
  aria-label="Flow diagram"
  style="cursor: {isPanning || spaceHeld ? 'grab' : isDraggingNode ? 'grabbing' : 'default'};"
>
  <defs>
    <pattern
      id="dot-grid"
      width={20 * vp.zoom}
      height={20 * vp.zoom}
      patternUnits="userSpaceOnUse"
      x={vp.panX % (20 * vp.zoom)}
      y={vp.panY % (20 * vp.zoom)}
    >
      <circle cx={10 * vp.zoom} cy={10 * vp.zoom} r={0.8 * vp.zoom} fill="#1e293b" />
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#0a0e17" />
  <rect width="100%" height="100%" fill="url(#dot-grid)" />

  <!-- Canvas content (transformed) -->
  <g transform="translate({vp.panX} {vp.panY}) scale({vp.zoom})">
    <!-- Edges (behind nodes) -->
    {#each canvasState.edges as edge (edge.id)}
      {@const srcNode = canvasState.nodes.find((n) => n.id === edge.source_node_id)}
      {@const tgtNode = canvasState.nodes.find((n) => n.id === edge.target_node_id)}
      {#if srcNode && tgtNode}
        <CanvasEdge
          {edge}
          sourceNode={srcNode}
          targetNode={tgtNode}
          sourceSchema={canvasState.nodeTypeMap.get(srcNode.type) ?? null}
          targetSchema={canvasState.nodeTypeMap.get(tgtNode.type) ?? null}
          selected={canvasState.selectedEdgeId === edge.id}
          onSelect={handleEdgeSelect}
        />
      {/if}
    {/each}

    <!-- Draft edge -->
    {#if canvasState.draftEdge}
      {@const srcPos = getDraftSourcePos()}
      <EdgeDraft
        draft={canvasState.draftEdge}
        sourceAbsX={srcPos.x}
        sourceAbsY={srcPos.y}
      />
    {/if}

    <!-- Nodes (render selected last for z-order) -->
    {#each canvasState.nodes.filter((n) => n.id !== canvasState.selectedNodeId) as node (node.id)}
      <g role="button" tabindex="-1" onmousedown={(e: MouseEvent) => handleNodeMouseDown(node.id, e)}>
        <CanvasNode
          {node}
          schema={canvasState.nodeTypeMap.get(node.type) ?? null}
          selected={false}
          onStartDraft={handleStartDraft}
          onCompleteDraft={handleCompleteDraft}
        />
      </g>
    {/each}

    <!-- Selected node on top -->
    {#if canvasState.selectedNode}
      {@const node = canvasState.selectedNode}
      <g role="button" tabindex="-1" onmousedown={(e: MouseEvent) => handleNodeMouseDown(node.id, e)}>
        <CanvasNode
          {node}
          schema={canvasState.nodeTypeMap.get(node.type) ?? null}
          selected={true}
          onStartDraft={handleStartDraft}
          onCompleteDraft={handleCompleteDraft}
        />
      </g>
    {/if}
  </g>

  <!-- Zoom indicator -->
  <text x="12" y="24" fill="#64748b" font-size="11" font-family="Inter, sans-serif">
    {Math.round(vp.zoom * 100)}%
  </text>
</svg>
</div>

<style>
  .canvas-interaction { position: relative; width: 100%; height: 100%; }
  .canvas-keyboard-tools { position: absolute; top: 8px; right: 8px; z-index: 1; max-width: 60%; }
  .canvas-direction-controls { display: flex; gap: 3px; flex-wrap: wrap; }
  .canvas-direction-controls button { background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); padding: 4px 8px; cursor: pointer; }
  .canvas-keyboard-tools output { display: block; background: var(--bg-card); font-size: 11px; }
  .canvas-keyboard-tools select { max-width: 100%; background: var(--bg-card); color: var(--text-primary); }
  .canvas-instructions { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  .canvas-svg {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    user-select: none;
  }
</style>
