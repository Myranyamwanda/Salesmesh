import { useEffect, useId, useState } from "react";
import {
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import Search from "@mui/icons-material/Search";

export type ToolbarFilter = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

/**
 * Search, filters, and the result count, at the top of the table card.
 * Search waits until typing pauses, so a server-side list is not asked for
 * every key press.
 */
export function TableToolbar({
  search,
  searchLabel,
  onSearch,
  filters = [],
  onFilter,
  count,
}: {
  search: string;
  searchLabel: string;
  onSearch: (value: string) => void;
  filters?: ToolbarFilter[];
  onFilter?: (name: string, value: string) => void;
  /** e.g. "41 agents"; announced to screen readers when it changes. */
  count?: string;
}) {
  const [text, setText] = useState(search);
  const [synced, setSynced] = useState(search);
  const baseId = useId();

  // "Clear filters" or Back changes the URL's search; show the new value.
  if (search !== synced) {
    setSynced(search);
    setText(search);
  }

  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => onSearch(text), 250);
    return () => clearTimeout(timer);
  }, [text, search, onSearch]);

  return (
    <div className="table-toolbar">
      <div className="table-toolbar-controls">
        <TextField
          className="table-search"
          label={searchLabel}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" aria-hidden="true" />
                </InputAdornment>
              ),
            },
          }}
        />
        {filters.map((filter) => {
          const labelId = `${baseId}-${filter.name}`;
          return (
            <FormControl
              key={filter.name}
              size="small"
              className="table-filter"
            >
              <InputLabel id={labelId}>{filter.label}</InputLabel>
              <Select
                labelId={labelId}
                label={filter.label}
                value={filter.value}
                onChange={(event) =>
                  onFilter?.(filter.name, event.target.value)
                }
              >
                {filter.options.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          );
        })}
      </div>
      {count && (
        <p className="table-count" role="status">
          {count}
        </p>
      )}
    </div>
  );
}
