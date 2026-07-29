import Link from "next/link";
import { XyneIcon } from "@/components/icons/XyneIcon";

export default function Navbar() {
  return (
    <nav className="sticky top-0 py-4 z-10 flex items-center justify-between px-5 w-full max-w-(--navbar-max-width) mx-auto bg-white">
      <Link href="/">
        <XyneIcon />
      </Link>
      <div className="flex items-center justify-center gap-4">
      </div>
    </nav>
  );
}
