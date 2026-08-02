import { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LoadingOverlay } from "@/components/ui/spinner";
import { LoginPage } from "@/components/auth/LoginPage";

interface AuthGuardProps {
    children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const { loading, hasSession, hasProfile, signOut } = useAuth();

    if (loading && !hasSession) {
        return <LoadingOverlay message="Authenticating..." />;
    }
    if (loading && hasSession) {
        return <LoadingOverlay message="Loading your profile..." />;
    }

    if (!hasSession) {
        return <LoginPage />;
    }

    if (!hasProfile) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#1A1A1A] text-white p-6 text-center">
                <h1 className="text-2xl font-bold mb-4 text-red-500">No Profile Found</h1>
                <p className="mb-6 text-zinc-400 max-w-md">
                    You have successfully logged in, but your email is not registered in our system.
                    Please contact an administrator.
                </p>
                <button
                    onClick={() => signOut()}
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                >
                    Sign Out & Try Another Account
                </button>
            </div>
        );
    }

    return <>{children}</>;
}
