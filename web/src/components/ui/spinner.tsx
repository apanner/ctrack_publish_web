"use client"

import { cn } from "@/lib/utils"

export type SpinnerVariant =
    | "ctrack"
    | "pulse"
    | "dots"
    | "ring"
    | "bars"
    | "orbit"
    | "grid"
    | "wave"
    | "spinner"
    | "dots-ring"
    | "modern"

export type SpinnerSize = "sm" | "md" | "lg" | "xl"

interface SpinnerProps {
    variant?: SpinnerVariant
    size?: SpinnerSize
    className?: string
    color?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
    xl: "w-16 h-16",
}

const fontSizeClasses: Record<SpinnerSize, string> = {
    sm: "text-[8px]",
    md: "text-[12px]",
    lg: "text-[18px]",
    xl: "text-[24px]",
}

export function Spinner({
    variant = "ctrack",
    size = "md",
    className,
    color = "#0096D6"
}: SpinnerProps) {
    const sizeClass = sizeClasses[size]
    const fontSizeClass = fontSizeClasses[size]

    const variants: Record<SpinnerVariant, JSX.Element> = {
        ctrack: (
            <div className={cn("relative flex items-center justify-center", sizeClass, className)}>
                <span
                    className={cn("absolute font-bold select-none tracking-tighter", fontSizeClass)}
                    style={{
                        color,
                        textShadow: `0 0 10px ${color}40`
                    }}
                >
                    C
                </span>
                <div
                    className="absolute inset-0 rounded-full border-2 border-transparent"
                    style={{
                        borderTopColor: color,
                        borderRightColor: color,
                        animation: "spin 1.2s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite",
                        filter: "drop-shadow(0 0 2px rgba(0, 150, 214, 0.3))"
                    }}
                />
                <div
                    className="absolute inset-1 rounded-full border border-transparent opacity-40"
                    style={{
                        borderBottomColor: color,
                        borderLeftColor: color,
                        animation: "spin 2s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite reverse",
                    }}
                />
                <div
                    className="absolute inset-0 rounded-full opacity-10 animate-pulse"
                    style={{ backgroundColor: color }}
                />
            </div>
        ),
        pulse: (
            <div className={cn("relative", sizeClass, className)}>
                <div
                    className="absolute inset-0 rounded-full animate-ping opacity-75"
                    style={{ backgroundColor: color }}
                />
                <div
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: color }}
                />
            </div>
        ),
        dots: (
            <div className={cn("flex gap-1.5 items-center justify-center", className)}>
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className={cn("rounded-full animate-bounce", size === "sm" ? "w-1.5 h-1.5" : size === "md" ? "w-2 h-2" : size === "lg" ? "w-2.5 h-2.5" : "w-3 h-3")}
                        style={{
                            backgroundColor: color,
                            animationDelay: `${i * 0.15}s`,
                            animationDuration: "0.6s",
                        }}
                    />
                ))}
            </div>
        ),
        ring: (
            <div className={cn("relative", sizeClass, className)}>
                <div
                    className="absolute inset-0 rounded-full border-4 border-transparent border-t-current animate-spin"
                    style={{ color }}
                />
            </div>
        ),
        bars: (
            <div className={cn("flex gap-1 items-center justify-center", className)}>
                {[0, 1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className={cn(
                            "rounded-sm animate-pulse",
                            size === "sm" ? "w-0.5 h-3" : size === "md" ? "w-1 h-4" : size === "lg" ? "w-1.5 h-6" : "w-2 h-8"
                        )}
                        style={{
                            backgroundColor: color,
                            animationDelay: `${i * 0.1}s`,
                            animationDuration: "0.8s",
                        }}
                    />
                ))}
            </div>
        ),
        orbit: (
            <div className={cn("relative", sizeClass, className)}>
                <div
                    className="absolute inset-0 rounded-full border-2 border-transparent border-t-current animate-spin"
                    style={{ color, animationDuration: "1s" }}
                />
                <div
                    className="absolute inset-2 rounded-full border-2 border-transparent border-b-current animate-spin"
                    style={{ color, animationDuration: "1.5s", animationDirection: "reverse" }}
                />
            </div>
        ),
        grid: (
            <div className={cn("grid grid-cols-3 gap-1", size === "sm" ? "w-4 h-4" : size === "md" ? "w-8 h-8" : size === "lg" ? "w-12 h-12" : "w-16 h-16", className)}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div
                        key={i}
                        className="rounded-sm animate-pulse"
                        style={{
                            backgroundColor: color,
                            animationDelay: `${(i % 3) * 0.1}s`,
                            animationDuration: "1s",
                        }}
                    />
                ))}
            </div>
        ),
        wave: (
            <div className={cn("flex gap-1 items-end justify-center", className)}>
                {[0, 1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className={cn(
                            "rounded-sm animate-pulse",
                            size === "sm" ? "w-0.5" : size === "md" ? "w-1" : size === "lg" ? "w-1.5" : "w-2"
                        )}
                        style={{
                            backgroundColor: color,
                            height: size === "sm" ? `${4 + i * 2}px` : size === "md" ? `${8 + i * 3}px` : size === "lg" ? `${12 + i * 4}px` : `${16 + i * 5}px`,
                            animationDelay: `${i * 0.1}s`,
                            animationDuration: "0.6s",
                        }}
                    />
                ))}
            </div>
        ),
        spinner: (
            <div className={cn("relative", sizeClass, className)}>
                <div
                    className="absolute inset-0 rounded-full border-4 border-gray-700 border-t-current animate-spin"
                    style={{ color }}
                />
            </div>
        ),
        "dots-ring": (
            <div className={cn("relative", sizeClass, className)}>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                    const angle = (i * 45) * (Math.PI / 180)
                    const radius = size === "sm" ? 6 : size === "md" ? 12 : size === "lg" ? 18 : 24
                    const x = Math.cos(angle) * radius
                    const y = Math.sin(angle) * radius
                    return (
                        <div
                            key={i}
                            className="absolute rounded-full animate-pulse"
                            style={{
                                backgroundColor: color,
                                width: size === "sm" ? "3px" : size === "md" ? "4px" : size === "lg" ? "5px" : "6px",
                                height: size === "sm" ? "3px" : size === "md" ? "4px" : size === "lg" ? "5px" : "6px",
                                left: `50%`,
                                top: `50%`,
                                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                                animationDelay: `${i * 0.1}s`,
                                animationDuration: "1.2s",
                            }}
                        />
                    )
                })}
            </div>
        ),
        modern: (
            <div className={cn("relative", sizeClass, className)}>
                <div
                    className="absolute inset-0 rounded-full border-4 border-transparent"
                    style={{
                        borderTopColor: color,
                        borderRightColor: color,
                        borderTopWidth: "4px",
                        borderRightWidth: "4px",
                        animation: "spin 0.8s linear infinite",
                    }}
                />
                <div
                    className="absolute inset-2 rounded-full border-2 border-transparent"
                    style={{
                        borderBottomColor: color,
                        borderLeftColor: color,
                        borderBottomWidth: "2px",
                        borderLeftWidth: "2px",
                        animation: "spin 1.2s linear infinite reverse",
                        opacity: 0.6,
                    }}
                />
            </div>
        ),
    }

    return (
        <div className="flex items-center justify-center">
            {variants[variant]}
        </div>
    )
}

/**
 * Full-screen loading overlay with spinner
 */
export function LoadingOverlay({
    variant = "modern",
    message = "Loading...",
    className
}: {
    variant?: SpinnerVariant
    message?: string
    className?: string
}) {
    return (
        <div className={cn(
            "fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm",
            className
        )}>
            <Spinner variant={variant} size="lg" />
            {message && (
                <p className="mt-4 text-white text-sm font-medium">{message}</p>
            )}
        </div>
    )
}

/**
 * Inline loading spinner with text
 */
export function LoadingSpinner({
    variant = "modern",
    size = "md",
    text,
    className
}: {
    variant?: SpinnerVariant
    size?: SpinnerSize
    text?: string
    className?: string
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
            <Spinner variant={variant} size={size} />
            {text && (
                <p className="text-gray-400 text-sm">{text}</p>
            )}
        </div>
    )
}
