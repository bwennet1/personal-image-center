"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Gallery } from "../../../components/Gallery";

function PhotosInner() {
  const q = useSearchParams().get("q") || undefined;
  return <Gallery q={q} />;
}

export default function PhotosPage() {
  return (
    <Suspense>
      <PhotosInner />
    </Suspense>
  );
}
