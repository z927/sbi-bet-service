export const formatDateItalian = (startTime: number | null): string | null => {
  if (!startTime || Number.isNaN(startTime)) {
    return null;
  }
  try {
    const date = new Date(startTime * 1000);
    const formatter = new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find((p) => p.type === "day")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const year = parts.find((p) => p.type === "year")?.value;
    if (day && month && year) {
      return `${day}-${month}-${year}`;
    }
    return null;
  } catch {
    return null;
  }
};
