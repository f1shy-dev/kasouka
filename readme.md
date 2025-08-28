# kasouka

virtual canvas table for large datasets

## features

- canvas-based rendering for performance
- virtual scrolling for millions of rows
- csv support with dynamic width estimation
- datasource abstraction for custom data
- typescript support

## usage

```ts
import { VirtualCanvasTable } from 'kasouka';

const table = new VirtualCanvasTable(canvas, {
  rowHeight: 24,
  headerHeight: 32
});

// load csv
table.loadCsv(csvData);

// or use custom datasource
table.setDataSource(dataSource);
```

## demo

// Start of Selection
check out [`demos/vanilla`](demos/vanilla) for a working example