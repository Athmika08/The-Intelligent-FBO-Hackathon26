/* Provided forecast data (planning support only).
   Source: the team's forecast JSON for Feb 10-16, 2027 in 2-hour intervals.
   - baseline: average arrivals per 2-hour interval (00-02 ... 22-24) by weekday, the "ordinary week"
   - predicted: expected arrivals per 2-hour interval for the low / medium / high scenarios
   Days run in calendar order: Wed Feb 10 ... Tue Feb 16. Weekly totals: low 197, medium 226, high 254; baseline 169.75.
   js/model.js reads this file for every arrival count; nothing else in the dashboard is changed by it. */
window.FORECAST_DATA = {
  warning: 'Planning support only. No landing, aircraft movement, or safety authorization.',
  intervalHours: 2,
  days: ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday'],
  baseline: [
    [0.25, 0.5, 0.5, 2.25, 3.75, 5.5, 2.25, 3.25, 5.0, 6.25, 1.5, 1.25],
    [0.5, 0.75, 0.25, 3.0, 3.25, 3.25, 3.25, 3.25, 3.75, 3.75, 2.5, 0.5],
    [0.25, 1.0, 1.25, 1.25, 4.0, 4.25, 2.5, 3.75, 3.75, 6.5, 1.0, 0.5],
    [0.25, 0.75, 0.5, 1.25, 2.75, 3.75, 1.5, 1.25, 3.0, 2.5, 0.5, 1.5],
    [0.0, 0.25, 0.0, 0.25, 1.75, 2.0, 1.75, 3.0, 1.75, 2.75, 1.0, 0.75],
    [0.25, 0.5, 0.25, 2.0, 3.5, 2.0, 3.25, 1.75, 3.5, 2.5, 1.25, 1.0],
    [0.5, 0.25, 0.0, 1.5, 3.5, 1.75, 3.75, 1.25, 5.75, 2.25, 1.75, 0.75]
  ],
  predicted: {
    low: [
      [0, 1, 1, 2, 4, 6, 2, 3, 5, 7, 2, 1],
      [1, 1, 0, 3, 4, 4, 4, 4, 4, 4, 3, 0],
      [0, 1, 2, 2, 5, 5, 3, 5, 5, 8, 1, 1],
      [0, 1, 1, 2, 4, 6, 2, 2, 4, 4, 1, 2],
      [0, 0, 0, 0, 2, 3, 2, 4, 2, 4, 1, 1],
      [0, 0, 0, 2, 4, 2, 3, 2, 4, 3, 1, 1],
      [1, 0, 0, 1, 3, 2, 4, 1, 6, 2, 2, 1]
    ],
    medium: [
      [0, 1, 1, 2, 4, 6, 2, 4, 5, 7, 2, 1],
      [1, 1, 0, 4, 4, 4, 4, 4, 5, 5, 3, 0],
      [0, 2, 2, 2, 6, 7, 4, 6, 6, 10, 1, 1],
      [1, 2, 1, 3, 5, 7, 3, 2, 6, 5, 1, 3],
      [0, 0, 0, 0, 3, 3, 3, 5, 3, 4, 2, 1],
      [0, 1, 0, 2, 4, 2, 3, 2, 4, 3, 1, 1],
      [1, 0, 0, 1, 3, 2, 4, 1, 6, 2, 2, 1]
    ],
    high: [
      [0, 1, 0, 3, 4, 6, 3, 4, 6, 7, 2, 1],
      [1, 1, 0, 4, 5, 5, 5, 4, 5, 5, 3, 1],
      [0, 2, 2, 2, 7, 8, 5, 7, 7, 12, 2, 1],
      [1, 2, 1, 3, 7, 9, 4, 3, 8, 6, 1, 4],
      [0, 1, 0, 0, 3, 4, 3, 6, 3, 5, 2, 1],
      [0, 1, 0, 2, 4, 2, 3, 2, 4, 3, 1, 1],
      [1, 0, 0, 1, 3, 2, 4, 1, 6, 2, 2, 1]
    ]
  }
};
