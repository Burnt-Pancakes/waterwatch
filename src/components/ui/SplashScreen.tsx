import { useEffect, useState } from "react";

interface SplashScreenProps {
  isVisible: boolean;
}

/**
 * Full-screen splash shown while the MapLibre map initializes.
 * Fades out when isVisible becomes false, then unmounts after the transition.
 */
export function SplashScreen({ isVisible }: SplashScreenProps) {
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!isVisible) {
      // Keep in DOM long enough for the opacity-0 transition to complete
      const t = setTimeout(() => setMounted(false), 500);
      return () => clearTimeout(t);
    }
    setMounted(true);
  }, [isVisible]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      style={{ backgroundColor: "#00695C" }}
    >
      <h1 className="text-4xl font-bold text-white">WaterVoice DMV</h1>
      <p className="mt-2 text-lg font-light" style={{ color: "#80CBC4" }}>
        DC Metro Water Quality
      </p>
    </div>
  );
}
