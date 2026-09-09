import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {/* LoginForm reads the `next` query param (set by proxy.ts when it
            bounces an unauthenticated deep link here), which makes it a
            dynamic client component — hence the boundary. */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
