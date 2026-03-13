import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSearchableDropdownOption {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
}

interface MultiSearchableDropdownProps {
  values: string[];
  options: MultiSearchableDropdownOption[];
  onValuesChange: (values: string[]) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  listClassName?: string;
  maxSelected?: number;
}

export const MultiSearchableDropdown: React.FC<
  MultiSearchableDropdownProps
> = ({
  values,
  options,
  onValuesChange,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  ariaLabel,
  disabled = false,
  triggerClassName,
  contentClassName,
  listClassName,
  maxSelected,
}) => {
  const [open, setOpen] = React.useState(false);

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onValuesChange(values.filter((v) => v !== value));
    } else {
      if (maxSelected !== undefined && values.length >= maxSelected) return;
      onValuesChange([...values, value]);
    }
  };

  const remove = (value: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onValuesChange(values.filter((v) => v !== value));
  };

  const selectedOptions = options.filter((o) => values.includes(o.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full justify-between",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selectedOptions.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              selectedOptions.map((option) => (
                <Badge
                  key={option.value}
                  variant="secondary"
                  className="flex shrink-0 items-center gap-1 px-1.5 py-0 text-xs"
                >
                  <span className="max-w-[120px] truncate">{option.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${option.label}`}
                    className="ml-0.5 cursor-pointer rounded-sm opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    onClick={(e) => remove(option.value, e)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[320px] p-0", contentClassName)}
      >
        <Command loop>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList
            className={cn("max-h-56", listClassName)}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const selected = values.includes(option.value);
                const searchableValue = [
                  option.label,
                  option.searchText ?? "",
                  option.value,
                ]
                  .join(" ")
                  .trim();

                return (
                  <CommandItem
                    key={option.value}
                    value={searchableValue}
                    disabled={
                      option.disabled ||
                      (maxSelected !== undefined &&
                        !selected &&
                        values.length >= maxSelected)
                    }
                    onSelect={() => toggle(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
