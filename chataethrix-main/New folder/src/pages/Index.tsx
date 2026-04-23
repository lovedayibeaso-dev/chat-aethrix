import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppSplash } from "@/components/AppSplash";

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!loading && splashDone) {
      navigate(user ? "/chat" : "/login", { replace: true });
    }
  }, [loading, splashDone, user, navigate]);

  return <AppSplash />;
}
