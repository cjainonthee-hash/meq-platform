// Thai display labels for enum values used across the UI. Values in the
// database stay in English; only what the user sees is translated.

export const roleTh: Record<string, string> = {
  admin: "ผู้ดูแลระบบ",
  lecturer: "อาจารย์",
  student: "นักศึกษา",
  guest: "ยังไม่กำหนดสิทธิ์",
};

export const examStatusTh: Record<string, string> = {
  draft: "ฉบับร่าง",
  scheduled: "ตั้งเวลาไว้",
  live: "กำลังสอบ",
  closed: "ปิดการสอบแล้ว",
  released: "ประกาศผลแล้ว",
};

export const confidenceTh: Record<string, string> = {
  high: "สูง",
  medium: "ปานกลาง",
  low: "ต่ำ",
};

export const courseRoleTh: Record<string, string> = {
  lecturer: "อาจารย์",
  student: "นักศึกษา",
};
