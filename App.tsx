import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Picker } from '@react-native-picker/picker';

type TimetableEvent = {
  day: string;
  start: string;
  durationMinutes: number;
  title: string;
  location: string;
  description: string;
};

type TimetableGroup = {
  id: string;
  label: string;
  parentGroup: string;
  events: TimetableEvent[];
};

type TimetableData = {
  generatedAt: string;
  groups: TimetableGroup[];
};

const timetableData = require('./src/data/timetables.json') as TimetableData;

const SEMESTER_START = '2026-01-19';
const SEMESTER_END = '2026-05-30';

const dayIndexByName: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const formatDateTimeLocal = (date: Date) => {
  const pad = (value: number) => `${value}`.padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const formatDateTimeUtc = (date: Date) => {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
};

const escapeIcsText = (value: string) => {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
};

const parseDateOnly = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day);
};

const getFirstOccurrence = (startDate: Date, targetDay: number) => {
  const date = new Date(startDate);
  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }
  return date;
};

const buildIcs = (group: TimetableGroup, startDate: string, endDate: string) => {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const until = new Date(end);
  until.setHours(23, 59, 59, 0);

  const events = group.events.map((event, index) => {
    const dayIndex = dayIndexByName[event.day] ?? 1;
    const firstDate = getFirstOccurrence(start, dayIndex);
    const [hour, minute] = event.start.split(':').map((part) => Number(part));
    const eventStart = new Date(firstDate);
    eventStart.setHours(hour, minute, 0, 0);
    const eventEnd = new Date(eventStart.getTime() + event.durationMinutes * 60000);

    const uid = `${group.id}-${event.day}-${event.start}-${index}@unischedule`;

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatDateTimeUtc(new Date())}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `DTSTART:${formatDateTimeLocal(eventStart)}`,
      `DTEND:${formatDateTimeLocal(eventEnd)}`,
      `RRULE:FREQ=WEEKLY;UNTIL=${formatDateTimeLocal(until)}`,
      event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
      event.description ? `DESCRIPTION:${escapeIcsText(event.description)}` : null,
      'END:VEVENT',
    ]
      .filter(Boolean)
      .join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UniSchedule//Timetable//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
};

const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const parseGroupMeta = (group: TimetableGroup) => {
  const baseId = group.parentGroup || group.id;
  const parts = baseId.split('.');
  const year = parts[0] ?? 'Unknown';
  const semester = parts[1] ?? 'S1';
  const mode = parts[2] ?? 'WE';
  const specialization = parts[3] ?? 'GEN';
  const yearKey = `${year}.${semester}`;
  return {
    year,
    semester,
    yearKey,
    mode,
    specialization,
  };
};

const toLabel = (value: string) => value.replace('.', '');
const modeLabel = (value: string) => (value === 'WE' ? 'Weekend' : value === 'WD' ? 'Weekday' : value);

const sortByStart = (a: TimetableEvent, b: TimetableEvent) => {
  const [aHour, aMinute] = a.start.split(':').map(Number);
  const [bHour, bMinute] = b.start.split(':').map(Number);
  if (aHour === bHour) {
    return aMinute - bMinute;
  }
  return aHour - bHour;
};

export default function App() {
  const { width } = useWindowDimensions();
  const isSmallScreen = width < 480;

  const groups = useMemo(() => {
    return [...timetableData.groups].sort((a, b) => a.label.localeCompare(b.label));
  }, []);
  const groupMeta = useMemo(() => {
    return groups.map((group) => ({ group, ...parseGroupMeta(group) }));
  }, [groups]);

  const yearOptions = useMemo(() => {
    return Array.from(new Set(groupMeta.map((item) => item.yearKey))).sort();
  }, [groupMeta]);

  const [yearKey, setYearKey] = useState(yearOptions[0] ?? '');

  const modeOptions = useMemo(() => {
    return Array.from(
      new Set(groupMeta.filter((item) => item.yearKey === yearKey).map((item) => item.mode)),
    ).sort();
  }, [groupMeta, yearKey]);

  const [mode, setMode] = useState(modeOptions[0] ?? '');

  const specializationOptions = useMemo(() => {
    return Array.from(
      new Set(
        groupMeta
          .filter((item) => item.yearKey === yearKey && item.mode === mode)
          .map((item) => item.specialization),
      ),
    ).sort();
  }, [groupMeta, yearKey, mode]);

  const [specialization, setSpecialization] = useState(specializationOptions[0] ?? '');

  const groupOptions = useMemo(() => {
    return groupMeta
      .filter((item) => item.yearKey === yearKey && item.mode === mode && item.specialization === specialization)
      .map((item) => item.group);
  }, [groupMeta, yearKey, mode, specialization]);

  const [selectedId, setSelectedId] = useState(groupOptions[0]?.id ?? '');

  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(yearKey)) {
      setYearKey(yearOptions[0]);
    }
  }, [yearOptions, yearKey]);

  useEffect(() => {
    if (modeOptions.length > 0 && !modeOptions.includes(mode)) {
      setMode(modeOptions[0]);
    }
  }, [modeOptions, mode]);

  useEffect(() => {
    if (specializationOptions.length > 0 && !specializationOptions.includes(specialization)) {
      setSpecialization(specializationOptions[0]);
    }
  }, [specializationOptions, specialization]);

  useEffect(() => {
    if (groupOptions.length > 0 && !groupOptions.some((group) => group.id === selectedId)) {
      setSelectedId(groupOptions[0].id);
    }
  }, [groupOptions, selectedId]);

  const selectedGroup = groups.find((group) => group.id === selectedId);
  const eventsByDay = useMemo(() => {
    if (!selectedGroup) {
      return [] as Array<{ day: string; events: TimetableEvent[] }>;
    }

    const byDay = new Map<string, TimetableEvent[]>();
    selectedGroup.events.forEach((event) => {
      const bucket = byDay.get(event.day) ?? [];
      bucket.push(event);
      byDay.set(event.day, bucket);
    });

    return dayOrder
      .map((day) => ({ day, events: (byDay.get(day) ?? []).sort(sortByStart) }))
      .filter((entry) => entry.events.length > 0);
  }, [selectedGroup]);

  const handleDownload = () => {
    if (!selectedGroup) {
      return;
    }

    if (Platform.OS !== 'web') {
      Alert.alert('Web only', 'ICS downloads are only available on web builds.');
      return;
    }

    const content = buildIcs(selectedGroup, SEMESTER_START, SEMESTER_END);
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedGroup.id}-timetable.ics`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <View style={styles.appShell}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[
        styles.scrollContent,
        isSmallScreen && styles.scrollContentCompact,
      ]}>
        <View style={[styles.heroCard, isSmallScreen && styles.heroCardCompact]}>
          <Text style={[styles.title, isSmallScreen && styles.titleCompact]}>UniSchedule</Text>
          <Text style={[styles.subtitle, isSmallScreen && styles.subtitleCompact]}>
            Choose your timetable and generate calendar events in one click.
          </Text>
          <Text style={[styles.metaLine, isSmallScreen && styles.metaLineCompact]}>
            Semester: {SEMESTER_START} to {SEMESTER_END}
          </Text>
        </View>

        <View style={[styles.panel, isSmallScreen && styles.panelCompact]}>
          <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleCompact]}>
            Select your timetable
          </Text>
          <View style={[styles.filtersWrap, isSmallScreen && styles.filtersWrapCompact]}>
            <View style={[styles.filterRow, isSmallScreen && styles.filterRowCompact]}>
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Year/Semester</Text>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={yearKey}
                    onValueChange={(value) => setYearKey(String(value))}
                    style={styles.picker}
                    dropdownIconColor="#0f172a"
                  >
                    {yearOptions.map((option) => (
                      <Picker.Item key={option} label={toLabel(option)} value={option} />
                    ))}
                  </Picker>
                </View>
              </View>

              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Mode</Text>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={mode}
                    onValueChange={(value) => setMode(String(value))}
                    style={styles.picker}
                    dropdownIconColor="#0f172a"
                  >
                    {modeOptions.map((option) => (
                      <Picker.Item key={option} label={modeLabel(option)} value={option} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>

            <View style={[styles.filterRow, isSmallScreen && styles.filterRowCompact]}>
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Specialization</Text>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={specialization}
                    onValueChange={(value) => setSpecialization(String(value))}
                    style={styles.picker}
                    dropdownIconColor="#0f172a"
                  >
                    {specializationOptions.map((option) => (
                      <Picker.Item key={option} label={option} value={option} />
                    ))}
                  </Picker>
                </View>
              </View>

              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Group</Text>
                <View style={styles.pickerWrap}>
                  <Picker
                    selectedValue={selectedId}
                    onValueChange={(value) => setSelectedId(String(value))}
                    style={styles.picker}
                    dropdownIconColor="#0f172a"
                  >
                    {groupOptions.map((group) => (
                      <Picker.Item key={group.id} label={group.label} value={group.id} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.summaryRow, isSmallScreen && styles.summaryRowCompact]}>
            <Text style={styles.summaryLabel}>Sessions</Text>
            <Text style={styles.summaryValue}>{selectedGroup?.events.length ?? 0}</Text>
          </View>

          <Pressable style={[styles.primaryButton, isSmallScreen && styles.primaryButtonCompact]} onPress={handleDownload}>
            <Text style={[styles.primaryButtonText, isSmallScreen && styles.primaryButtonTextCompact]}>
              Download .ics Calendar
            </Text>
          </Pressable>

          <Text style={styles.helperText}>
            The download includes weekly recurring events from the timetable and uses your local timezone.
          </Text>
        </View>

        <View style={[styles.panel, isSmallScreen && styles.panelCompact]}>
          <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleCompact]}>
            Timetable preview
          </Text>

          {eventsByDay.length === 0 ? (
            <Text style={styles.emptyState}>No sessions found for this timetable.</Text>
          ) : (
            eventsByDay.map((entry) => (
              <View key={entry.day} style={styles.dayCard}>
                <Text style={styles.dayTitle}>{entry.day}</Text>
                {entry.events.map((event, index) => (
                  <View key={`${event.day}-${event.start}-${index}`} style={styles.sessionRow}>
                    <View style={styles.sessionTime}>
                      <Text style={styles.sessionTimeText}>{event.start}</Text>
                      <Text style={styles.sessionDuration}>{event.durationMinutes} min</Text>
                    </View>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionTitle}>{event.title}</Text>
                      {event.location ? (
                        <Text style={styles.sessionMeta}>{event.location}</Text>
                      ) : null}
                      {event.description ? (
                        <Text style={styles.sessionMeta}>{event.description}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 24,
    gap: 20,
    alignItems: 'center',
  },
  scrollContentCompact: {
    padding: 16,
    gap: 16,
  },
  heroCard: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: '#111827',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  heroCardCompact: {
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 18,
  },
  title: {
    fontSize: 36,
    color: '#f9fafb',
    fontWeight: '700',
    letterSpacing: 0.6,
    fontFamily: 'Georgia',
  },
  titleCompact: {
    fontSize: 28,
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 10,
    fontSize: 16,
    color: '#cbd5f5',
    lineHeight: 22,
  },
  subtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
  metaLine: {
    marginTop: 16,
    fontSize: 13,
    color: '#94a3b8',
    letterSpacing: 0.4,
  },
  metaLineCompact: {
    marginTop: 12,
    fontSize: 12,
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: '#f8fafc',
    borderRadius: 24,
    padding: 24,
  },
  panelCompact: {
    borderRadius: 20,
    padding: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 12,
  },
  sectionTitleCompact: {
    fontSize: 16,
    marginBottom: 10,
  },
  pickerWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  picker: {
    width: '100%',
    color: '#0f172a',
  },
  filtersWrap: {
    gap: 12,
  },
  filtersWrapCompact: {
    gap: 10,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 12,
  },
  filterRowCompact: {
    flexDirection: 'column',
  },
  filterBlock: {
    flex: 1,
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  summaryRow: {
    marginTop: 16,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryRowCompact: {
    marginTop: 12,
    padding: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#1e293b',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  primaryButton: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#f97316',
    alignItems: 'center',
  },
  primaryButtonCompact: {
    marginTop: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  primaryButtonTextCompact: {
    fontSize: 15,
  },
  helperText: {
    marginTop: 12,
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },
  emptyState: {
    color: '#64748b',
    fontSize: 13,
  },
  dayCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  sessionTime: {
    width: 74,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionTimeText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 13,
  },
  sessionDuration: {
    marginTop: 2,
    color: '#cbd5f5',
    fontSize: 10,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  sessionMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 16,
  },
});
