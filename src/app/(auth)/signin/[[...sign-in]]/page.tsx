import { SignIn } from "@clerk/nextjs";

// AIX Core auth: Clerk hosts the sign-in. In production the shared Clerk
// session across *.aiworkforce.md means users usually arrive already
// authenticated (from Core); this page is the fallback / local-dev sign-in.
export default function SignInPage() {
  return (
    <div className="flex justify-center">
      <SignIn />
    </div>
  );
}
