interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div data-id="section-header" className="px-xyne-2 pt-xyne-4 pb-xyne-2">
      <h2 data-id="section-header-title" className="text-sm font-[550] text-xyne-fg-primary">
        {title}
      </h2>
    </div>
  );
}
