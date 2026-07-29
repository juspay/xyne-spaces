"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChangelogFiltersProps {
  months: string[];
  years: string[];
}

const ChevronDownIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 6L8 10L12 6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function ChangelogFilters({ months, years }: ChangelogFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedMonth = searchParams.get("month") || "All";
  const selectedYear = searchParams.get("year") || "All";

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "All") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const queryString = params.toString();
    router.push(queryString ? `?${queryString}` : "/");
  };

  return (
    <div className="flex gap-3">
      {/* Month filter */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 px-4 py-2 rounded-lg text-[#7C8698] bg-[#F7F7F7] hover:bg-gray-50 transition-colors cursor-pointer">
          <span>{selectedMonth}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => updateFilter("month", "All")}
            className={selectedMonth === "All" ? "bg-gray-100" : ""}
          >
            All
          </DropdownMenuItem>
          {months.map((month) => (
            <DropdownMenuItem
              key={month}
              onClick={() => updateFilter("month", month)}
              className={selectedMonth === month ? "bg-gray-100" : ""}
            >
              {month}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Year filter */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 px-4 py-2 rounded-lg text-[#7C8698] bg-[#F7F7F7] hover:bg-gray-50 transition-colors cursor-pointer">
          <span>{selectedYear}</span>
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => updateFilter("year", "All")}
            className={selectedYear === "All" ? "bg-gray-100" : ""}
          >
            All
          </DropdownMenuItem>
          {years.map((year) => (
            <DropdownMenuItem
              key={year}
              onClick={() => updateFilter("year", year)}
              className={selectedYear === year ? "bg-gray-100" : ""}
            >
              {year}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
