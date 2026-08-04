import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Landing: routes each user to their role's dashboard. */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  switch (profile?.role) {
    case "admin":
      redirect("/admin");
    case "lecturer":
      redirect("/lecturer");
    case "student":
      redirect("/student");
    default:
      redirect("/guest");
  }
}
