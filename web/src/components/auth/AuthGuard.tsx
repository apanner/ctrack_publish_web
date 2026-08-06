import { ReactNode } from "react"
import { useAuth } from "@/hooks/use-auth"
import { LoadingOverlay } from "@/components/ui/spinner"
import { LoginPage } from "@/components/auth/LoginPage"

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { loading, hasSession, hasProfile, hasStudio, studioError, signOut } = useAuth()

  if (loading && !hasSession) {
    return <LoadingOverlay message="Authenticating..." />
  }
  if (loading && hasSession) {
    return <LoadingOverlay message="Loading your profile..." />
  }

  if (!hasSession) {
    return <LoginPage />
  }

  if (!hasProfile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#1A1A1A] p-6 text-center text-white">
        <h1 className="mb-4 text-2xl font-bold text-red-500">No Profile Found</h1>
        <p className="mb-6 max-w-md text-zinc-400">
          You have successfully logged in, but your email is not registered in our system. Please
          contact an administrator.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md bg-red-600 px-6 py-2 transition-colors hover:bg-red-700"
        >
          Sign Out & Try Another Account
        </button>
      </div>
    )
  }

  if (!hasStudio) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#1A1A1A] p-6 text-center text-white">
        <h1 className="mb-4 text-2xl font-bold text-amber-400">No Studio Access</h1>
        <p className="mb-6 max-w-md text-zinc-400">
          {studioError ||
            "Your account is not a member of any studio. Ask a studio admin to add you, then sign in again."}
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-md bg-red-600 px-6 py-2 transition-colors hover:bg-red-700"
        >
          Sign Out
        </button>
      </div>
    )
  }

  return <>{children}</>
}
