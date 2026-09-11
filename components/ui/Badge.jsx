import { cn } from '@/lib/cn';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/14 text-success',
  danger: 'bg-danger/12 text-danger',
  warning: 'bg-warning/20 text-warning-foreground',
};

export default function Badge({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
        TONES[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
