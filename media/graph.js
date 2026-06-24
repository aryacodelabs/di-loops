(function () {
  const vscode = acquireVsCodeApi();
  let network = null;

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'update') {
      renderGraph(message.data);
    }
  });

  function renderGraph(data) {
    const container = document.getElementById('graph');
    if (!container || !window.vis) {
      return;
    }

    const nodes = new vis.DataSet(
      data.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        color: {
          background: node.color,
          border: node.border ?? node.color,
          highlight: { background: node.color, border: node.border ?? node.color },
        },
        borderWidth: node.border ? 3 : 1,
        shape: 'box',
        font: { color: '#ffffff', multi: true },
      })),
    );

    const edges = new vis.DataSet(
      data.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        color: edge.color ? { color: edge.color } : undefined,
        label: edge.label,
        arrows: 'to',
        font: { align: 'middle', color: '#cccccc' },
      })),
    );

    const options = {
      physics: {
        stabilization: true,
        barnesHut: { gravitationalConstant: -8000, springLength: 120 },
      },
      interaction: { hover: true, tooltipDelay: 100 },
      layout: { improvedLayout: true },
    };

    if (network) {
      network.destroy();
    }

    network = new vis.Network(container, { nodes, edges }, options);

    network.on('click', (params) => {
      if (!params.nodes?.length) {
        return;
      }
      const node = data.nodes.find((n) => n.id === params.nodes[0]);
      if (node?.registrationId) {
        vscode.postMessage({
          type: 'navigate',
          registrationId: node.registrationId,
        });
        return;
      }
      if (node?.fileUri && node?.range) {
        vscode.postMessage({
          type: 'navigate',
          fileUri: node.fileUri,
          range: node.range,
        });
      }
    });

    if (data.focusNodeId) {
      network.selectNodes([data.focusNodeId]);
      network.focus(data.focusNodeId, { scale: 1.1, animation: true });
    }
  }
})();