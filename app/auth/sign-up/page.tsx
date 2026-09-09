import { Suspense } from "react";
import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {/* See the login page: reads `next` from the URL, so it needs a
            Suspense boundary to stay prerenderable. */}
        <Suspense>
          <SignUpForm />
        </Suspense>
      </div>
    </div>
  );
}
