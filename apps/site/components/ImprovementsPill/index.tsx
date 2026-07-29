import clsx from "clsx";
import React from "react";

export const ImprovementsPill = ({
  label,
  sublabel,
  bgColor,
  icon,
}: {
  label: string;
  sublabel: string;
  bgColor: string;
  icon: React.ReactNode;
}) => {
  return (
    <div
      className={clsx(
        "flex items-center gap-[22px] rounded-xl py-5 pl-7 pr-8",
        bgColor,
      )}
    >
      <div className="shrink-0 flex items-center justify-center">{icon}</div>
      <div>
        <h4 className="overflow-hidden text-[#0F406F] text-ellipsis text-lg not-italic font-semibold leading-normal">
          {label}
        </h4>
        <p className="text-[#0F406F] text-ellipsis text-base font-light leading-[16px]">
          {sublabel}
        </p>
      </div>
    </div>
  );
};
