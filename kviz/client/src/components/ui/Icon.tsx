import type { LucideIcon } from 'lucide-react';

interface IconProps {
  icon: LucideIcon;
  size?: 16 | 20 | 24;
  className?: string;
}

export function Icon({ icon: Ic, size = 20, className }: IconProps) {
  return <Ic size={size} strokeWidth={1.75} className={className} />;
}
