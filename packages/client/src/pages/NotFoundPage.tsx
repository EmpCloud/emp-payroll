import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Home, ArrowLeft } from "lucide-react";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="text-center">
        <p className="text-7xl font-bold text-brand-600">404</p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-gray-100">Page not found</h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Go Back
          </Button>
          <Button onClick={() => navigate("/")}>
            <Home className="h-4 w-4" /> Home
          </Button>
        </div>
      </div>
    </div>
  );
}
