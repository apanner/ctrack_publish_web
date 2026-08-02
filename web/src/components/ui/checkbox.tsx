"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
    checked?: boolean | "indeterminate"
    onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({ className, checked, onCheckedChange, ...props }, ref) => {
        const isControlled = checked !== undefined
        const [internalChecked, setInternalChecked] = React.useState(false)
        const value = isControlled ? (checked === true || checked === "indeterminate") : internalChecked

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const next = e.target.checked
            if (!isControlled) setInternalChecked(next)
            onCheckedChange?.(next)
        }

        return (
            <input
                type="checkbox"
                ref={ref}
                checked={value}
                onChange={handleChange}
                className={cn(
                    "h-4 w-4 rounded border border-[#404040] bg-[#1A1A1A] text-[#0096D6] focus:ring-2 focus:ring-[#0096D6] focus:ring-offset-0 focus:ring-offset-[#1A1A1A] cursor-pointer",
                    className
                )}
                {...props}
            />
        )
    }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
