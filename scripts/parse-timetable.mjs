import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { parse } from 'node-html-parser';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join('src', 'data', 'timetables.json');

if (!inputPath) {
  console.error('Usage: node scripts/parse-timetable.mjs <input-html> [output-json]');
  process.exit(1);
}

const html = readFileSync(inputPath, 'utf-8');
const root = parse(html);

const tables = root.querySelectorAll('table[id^="table_"]');

const groups = [];

const toTextLines = (node) => {
  const htmlValue = node.innerHTML || '';
  const withBreaks = htmlValue.replace(/<br\s*\/?\s*>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '-x-' && line !== '---');
};

const parseDetailedTable = (detailTable) => {
  const rows = detailTable.querySelectorAll('tr');
  if (rows.length === 0) {
    return [];
  }

  const getDirectCells = (row) => {
    return row.childNodes.filter((node) => node.tagName === 'TD' || node.rawTagName === 'td');
  };

  const colCount = getDirectCells(rows[0]).length;
  const columns = Array.from({ length: colCount }, () => []);

  rows.forEach((row) => {
    const cells = getDirectCells(row);
    cells.forEach((cell, index) => {
      const text = (cell.text || '').trim();
      columns[index].push(text);
    });
  });

  return columns.map((col) => {
    return {
      subgroup: col[0] || 'Unknown',
      title: col[1] || 'Session',
      lecturers: col[2] || '',
      location: col[3] || '',
    };
  });
};

const parseMainCell = (cell) => {
  const lines = toTextLines(cell);
  if (lines.length === 0) {
    return null;
  }

  return {
    title: lines[0] || 'Session',
    lecturers: lines[1] || '',
    location: lines[2] || '',
  };
};

const addEvent = (bucket, event) => {
  bucket.push({
    day: event.day,
    start: event.start,
    durationMinutes: event.durationMinutes,
    title: event.title,
    location: event.location,
    description: event.description,
  });
};

const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map((value) => Number(value));
  return hours * 60 + minutes;
};

const mergeContiguousEvents = (events) => {
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayIndex = new Map(dayOrder.map((day, index) => [day, index]));

  const sorted = [...events].sort((a, b) => {
    const dayDiff = (dayIndex.get(a.day) ?? 0) - (dayIndex.get(b.day) ?? 0);
    if (dayDiff !== 0) {
      return dayDiff;
    }
    return toMinutes(a.start) - toMinutes(b.start);
  });

  const merged = [];
  sorted.forEach((event) => {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...event });
      return;
    }

    const lastEnd = toMinutes(last.start) + last.durationMinutes;
    const currentStart = toMinutes(event.start);
    const sameDetails =
      last.day === event.day &&
      last.title === event.title &&
      last.location === event.location &&
      last.description === event.description;

    if (sameDetails && lastEnd === currentStart) {
      last.durationMinutes += event.durationMinutes;
      return;
    }

    merged.push({ ...event });
  });

  return merged;
};

tables.forEach((table) => {
  const groupHeader = table.querySelector('thead tr th[colspan]');
  const mainGroup = groupHeader ? groupHeader.text.trim() : 'Unknown';
  const dayHeaders = table.querySelectorAll('thead th.xAxis');
  const days = dayHeaders.map((th) => th.text.trim());

  const sharedEvents = [];
  const subgroupEvents = new Map();

  const bodyRows = table.querySelectorAll('tbody tr');
  const activeSpans = Array.from({ length: days.length }, () => 0);

  bodyRows.forEach((row) => {
    const timeCell = row.querySelector('th.yAxis');
    if (!timeCell) {
      return;
    }

    const startTime = timeCell.text.trim();
    const cells = row.childNodes.filter((node) => node.tagName === 'TD' || node.rawTagName === 'td');
    let cellIndex = 0;

    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      if (activeSpans[dayIndex] > 0) {
        activeSpans[dayIndex] -= 1;
        continue;
      }

      const cell = cells[cellIndex];
      cellIndex += 1;

      if (!cell) {
        continue;
      }

      const rowSpan = Number(cell.getAttribute('rowspan') || '1');
      if (rowSpan > 1) {
        activeSpans[dayIndex] = rowSpan - 1;
      }

      const detailTable = cell.querySelector('table.detailed');
      const durationMinutes = rowSpan * 60;

      if (detailTable) {
        const detailedEntries = parseDetailedTable(detailTable);
        detailedEntries.forEach((entry) => {
          if (!subgroupEvents.has(entry.subgroup)) {
            subgroupEvents.set(entry.subgroup, []);
          }

          addEvent(subgroupEvents.get(entry.subgroup), {
            day: days[dayIndex],
            start: startTime,
            durationMinutes,
            title: entry.title,
            location: entry.location,
            description: [entry.lecturers, `Group ${entry.subgroup}`].filter(Boolean).join('\n'),
          });
        });
        continue;
      }

      const mainEntry = parseMainCell(cell);
      if (!mainEntry) {
        continue;
      }

      addEvent(sharedEvents, {
        day: days[dayIndex],
        start: startTime,
        durationMinutes,
        title: mainEntry.title,
        location: mainEntry.location,
        description: mainEntry.lecturers,
      });
    }
  });

  if (subgroupEvents.size > 0) {
    subgroupEvents.forEach((events, subgroup) => {
      const mergedEvents = mergeContiguousEvents([...sharedEvents, ...events]);
      groups.push({
        id: subgroup,
        label: `${subgroup} (${mainGroup})`,
        parentGroup: mainGroup,
        events: mergedEvents,
      });
    });
  } else {
    groups.push({
      id: mainGroup,
      label: mainGroup,
      parentGroup: mainGroup,
      events: mergeContiguousEvents(sharedEvents),
    });
  }
});

const output = {
  generatedAt: new Date().toISOString(),
  groups,
};

writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
console.log(`Wrote ${groups.length} timetables to ${outputPath}`);
