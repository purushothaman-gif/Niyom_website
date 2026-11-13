interface LogoProps {
  /** `fluid` = 40px on phones, 56px from sm up (the landing header). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'fluid';
  className?: string;
}

const sizeMap = {
  sm: 'h-12 w-12',
  md: 'h-14 w-14',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
  fluid: 'h-10 w-10 sm:h-14 sm:w-14',
};

export function Logo({ size = 'md', className = '' }: LogoProps) {
  const sizeClass = sizeMap[size];

  return (
    <img
      src="/niyomlogo.png"
      alt="Niyom Wealth Logo"
      className={`${sizeClass} ${className}`}
    />
  );
}
