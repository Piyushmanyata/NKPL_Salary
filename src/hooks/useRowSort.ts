import { useState } from "react";

export function useRowSort(defaultField = "name") {
  const [sortField, setSortField] = useState(defaultField);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return { sortField, sortDirection, handleSort };
}
