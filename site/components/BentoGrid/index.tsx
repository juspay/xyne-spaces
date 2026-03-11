import Image from "next/image";
import clsx from "clsx";
import { TicketComponentBento } from "./TicketComponentBento";

function TicketManagementCard() {
  return (
    <div
      className={clsx(
        "ticket-management group/tickets",
        "p-8.5 rounded-3xl bg-[#FDF5FE]",
      )}
    >
      <>
        <h3 className="text-[1.375rem] font-semibold text-[#0A96A7]">
          Mobile Improvements
        </h3>
        <ul className="mt-3 px-4 *:font-light list-disc">
          <li>Smoother chat experience on phones and tablets</li>
          <li>Better keyboard handling (Enter key now works as expected!)</li>
          <li>Updated iOS app with new icons</li>
        </ul>
      </>
      <div className="relative isolate grid *:[grid-area:1/-1]">
        <div className="z-0 w-full *:w-full rotate-[9.145deg] pointer-events-none">
          <TicketComponentBento className="w-full" />
        </div>
        <div className="z-10 w-ful *:w-full rotate-[9.145deg] pointer-events-none group-hover/tickets:rotate-[5deg] transition-transform">
          <TicketComponentBento className="w-full" />
        </div>
        <div className="z-20 w-ful *:w-full rotate-[9.145deg] pointer-events-none group-hover/tickets:rotate-0 transition-transform">
          <TicketComponentBento className="w-full" />
        </div>
      </div>
    </div>
  );
}
function CallHistoryCard() {
  return (
    <div
      className={clsx(
        "call-history group min-[1280px]:row-span-2",
        "grid rounded-3xl bg-[#FFF9F6] overflow-clip",
      )}
    >
      <div className="p-8.5 pb-0">
        <h3 className="text-[1.375rem] font-semibold text-[#BD4B12]">
          Call History
        </h3>
        <p className="mt-3 font-light">
          Never lose track of your calls again. View your complete call history,
          including who you missed and when.
        </p>
      </div>
      <figure className="self-end w-full mt-7 px-12.5 rounded-t-xl">
        <Image
          src="/changelog/assets/call-history-card.png"
          alt="call-history-feature-image"
          width={800}
          height={600}
          className="rounded-[inherit] size-full object-center shadow-[0_3.559px_10.678px_#FDD8C6] transition-transform duration-300 ease-out group-hover:scale-105"
        />
      </figure>
    </div>
  );
}
function MobileImprovements() {
  return (
    <div
      className={clsx(
        "mobile-improvements group min-[1280px]:col-start-3 min-[1280px]:row-span-3",
        "p-8.5 rounded-3xl bg-[#EEFCFF]",
      )}
    >
      <h3 className="text-[1.375rem] font-semibold text-[#0A96A7]">
        Mobile Improvements
      </h3>
      <ul className="mt-3 px-4 *:font-light list-disc">
        <li>Smoother chat experience on phones and tablets</li>
        <li>Better keyboard handling (Enter key now works as expected!)</li>
        <li>Updated iOS app with new icons</li>
      </ul>
      <figure className="w-full mt-7 rounded-3xl drop-shadow-[0_1.78px_10.678px_0_rgba(44,89,94,0.73)]">
        <Image
          src="/changelog/assets/mobile-improvement-card.png"
          alt="mobile-improvement-feature-image"
          width={800}
          height={600}
          className="rounded-[inherit] size-full object-center object-cover transition-transform duration-300 ease-out group-hover:scale-105"
        />
      </figure>
    </div>
  );
}
function UniversalSearch() {
  return (
    <div
      className={clsx(
        "universal-search group min-[1280px]:row-span-2",
        "px-12.5 p-8.5 rounded-3xl bg-[#F8FDF5]",
      )}
    >
      <h3 className="text-[1.375rem] font-semibold text-[#2E6B0B]">
        Universal Search
      </h3>
      <p className="mt-3 font-light">
        Find anything in seconds. Search across all messages, channels, people,
        tickets, and files from one search bar.
      </p>
      <figure className="w-full mt-7 rounded-xl shadow-[0_3.559px_10.678px_0_rgba(0,0,0,0.06)]">
        <Image
          src="/changelog/assets/universal-search-card.png"
          alt="universal-search-feature-image"
          width={800}
          height={600}
          className="rounded-[inherit] size-full object-center object-cover transition-transform duration-300 ease-out group-hover:scale-105"
        />
      </figure>
    </div>
  );
}
function PersonalizeWorkspace() {
  return (
    <div
      className={clsx(
        "personalize-workspace group",
        "grid rounded-3xl bg-[#F7F6FF] overflow-clip",
      )}
    >
      <div className="p-12.5 pt-8.5 pb-0">
        <h3 className="text-[1.375rem] font-semibold text-[#4E3DD6]">
          Personalize Your Workspace
        </h3>
        <p className="mt-3 font-light">
          Choose from multiple themes to make Xyne Spaces your own. Find it in
          your settings!
        </p>
      </div>
      <figure className="self-end pl-12.5 pr-0 pb-0 mt-7">
        <Image
          src="/changelog/assets/workspace-personalize-card.png"
          alt="workspace-personalize-feature-image"
          width={800}
          height={600}
          className="rounded-tl-xl size-full object-center object-cover ~shadow-[0_0_8.009px_0_rgba(151,142,217,0.69)] transition-transform duration-300 ease-out group-hover:scale-105"
        />
      </figure>
    </div>
  );
}

export default function BentoGrid() {
  return (
    <div className="mt-13 grid min-[1280px]:grid-cols-3 gap-5 ~min-[1280px]:grid-rows-[3.9fr_1fr_3.3fr] px-10">
      <TicketManagementCard />
      <CallHistoryCard />
      <MobileImprovements />
      <UniversalSearch />
      <PersonalizeWorkspace />
    </div>
  );
}
