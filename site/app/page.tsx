import { changelogSource, Page } from "@/lib/source";
import { ChangelogFilters } from "@/components/ChangelogFilters";
import Link from "next/link";
import { format, parseISO, getYear } from "date-fns";
import { formatDate } from "@/lib/utils";

function getFilterOptions(pages: Page[]): { months: string[]; years: string[] } {
  const monthsSet = new Set<string>();
  const yearsSet = new Set<string>();

  for (const page of pages) {
    const date = parseISO(page.data.date);
    monthsSet.add(format(date, "MMMM"));
    yearsSet.add(getYear(date).toString());
  }

  const monthOrder = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const months = Array.from(monthsSet).sort(
    (a, b) => monthOrder.indexOf(a) - monthOrder.indexOf(b)
  );

  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));

  return { months, years };
}

function filterPages(
  pages: Page[],
  month: string | null,
  year: string | null
): Page[] {
  return pages.filter((page) => {
    const date = parseISO(page.data.date);
    const pageMonth = format(date, "MMMM");
    const pageYear = getYear(date).toString();

    if (month && month !== "All" && pageMonth !== month) {
      return false;
    }
    if (year && year !== "All" && pageYear !== year) {
      return false;
    }
    return true;
  });
}

function groupPagesByDate(pages: Page[]): Map<string, Page[]> {
  const grouped = new Map<string, Page[]>();

  const sortedPages = [...pages].sort(
    (a, b) => parseISO(b.data.date).getTime() - parseISO(a.data.date).getTime()
  );

  for (const page of sortedPages) {
    const date = page.data.date;
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(page);
  }

  return grouped;
}

interface HomeProps {
  searchParams: Promise<{ month?: string; year?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const allPages = changelogSource.getPages();
  const { months, years } = getFilterOptions(allPages);

  const filteredPages = filterPages(allPages, params.month || null, params.year || null);
  const groupedPages = groupPagesByDate(filteredPages);

  return (
    <div className="min-h-[calc(1.5 * 100vh)] pb-[400px]">
      <div className="max-w-(--page-max-width) mx-auto">
        {/* Header */}
        <div className="w-full mx-auto py-12">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-7">
              <span className="inline-block px-[14.24px] py-[9.5px] bg-[#FF4F4F] text-white text-lg font-medium rounded-[37.98px] w-fit">
                What&apos;s new?
              </span>
              <h1 className="text-[#0F406F] text-7xl font-medium ">
                Particular updates &<br />
                some enhancements
              </h1>
            </div>
            {/* Month/Year filters */}
            <ChangelogFilters months={months} years={years} />
          </div>
        </div>

        {/* Timeline */}
        <div className="relative my-20">
          {/* Continuous timeline line */}
          <div
            className="absolute left-[7px] top-2 bottom-0 w-px bg-[#E4E7EC]"
            aria-hidden
          />

          {Array.from(groupedPages.entries()).map(([date, datePages]) => (
            <DateGroup key={date} date={date} pages={datePages} />
          ))}

          {groupedPages.size === 0 && (
            <div className="text-center py-12 text-gray-500">
              No changelog entries found for the selected filters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DateGroup = ({ date, pages }: { date: string; pages: Page[] }) => {
  return (
    <div className="flex gap-10 pb-12">
      {/* Left column: dot + date */}
      <div className="flex items-start gap-4 shrink-0">
        <div className="relative z-10 flex w-[14px] shrink-0 items-center justify-center pt-1">
          <div
            className="h-2 w-2 shrink-0 rounded-full bg-[#0F406F]"
            aria-hidden
          />
        </div>
        <div className="w-[140px] text-[#0F406F] text-[16px] font-medium tracking-[-0.15px]">
          {formatDate(date)}
        </div>
      </div>

      {/* Right column: list of items for this date */}
      <div className="flex-1 space-y-8">
        {pages.map((page) => (
          <ChangeLogItem key={page.slugs.join("/")} page={page} />
        ))}
      </div>
    </div>
  );
};

const ChangeLogItem = ({ page }: { page: Page }) => {
  return (
    <div className="group">
      <Link href={`/${page.slugs.join("/")}`}>
        <h3 className="text-[#0F406F] text-[20px] font-medium tracking-[-0.1px] leading-[140%] decoration-[#0F406F] group-hover:text-[#E84E36] group-hover:decoration-[#E84E36] transition-colors">
          {page.data.title}
        </h3>
      </Link>
      <p className="text-[#4A5568] text-[15px] leading-[160%] mt-2 max-w-[600px]">
        {page.data.description}
      </p>
    </div>
  );
};
