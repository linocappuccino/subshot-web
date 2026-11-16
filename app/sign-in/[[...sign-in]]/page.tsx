import { SignIn } from "@clerk/nextjs";
import { KickedNotice } from "@/app/components/SeatGuard";

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16">
      <KickedNotice />
      <SignIn />
    </div>
  );
}
