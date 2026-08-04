import { requireProfile } from "@/lib/auth";
import { Header } from "@/components/Header";

export default async function GuestPage() {
  const profile = await requireProfile();
  return (
    <>
      <Header profile={profile} />
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="card">
          <h1 className="text-xl font-bold">ยินดีต้อนรับ</h1>
          <p className="mt-3 text-sm text-slate-600">
            บัญชีของคุณเข้าสู่ระบบแล้ว แต่ยังไม่ได้ถูกกำหนดให้อยู่ในรายวิชาใด
            หากคุณเป็นนักศึกษา กรุณาแจ้งอาจารย์ให้เพิ่มคุณเข้าชั้นเรียน
            หากคุณเป็นอาจารย์ กรุณาแจ้งผู้ดูแลระบบให้กำหนดสิทธิ์อาจารย์ให้คุณ
          </p>
          <p className="mt-3 text-xs text-slate-400">
            เข้าสู่ระบบในชื่อ {profile.email}
          </p>
        </div>
      </main>
    </>
  );
}
