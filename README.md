# UniSchedule

A React Native Web app (Expo) that lets students pick a timetable and download an .ics calendar file with weekly recurring sessions.

## Features
- Timetable dropdown built from the provided HTML export
- One-click .ics download for web
- Weekly recurring events between the configured semester dates

## Run locally
```bash
npm install
npm run web
```

## Regenerate timetable data
If the source HTML changes, regenerate the JSON data file:
```bash
npm run parse:timetable -- "/absolute/path/to/Student Timetable for Semester I January 2026 Weekend Version III.html" "src/data/timetables.json"
```

## Semester dates
Update these in App.tsx if the semester dates change:
- `SEMESTER_START`
- `SEMESTER_END`
