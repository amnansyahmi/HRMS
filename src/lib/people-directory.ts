import type { HRRecord } from "./types";

export type DirectoryFilters = {
  search: string;
  department: string;
  status: string;
  employment: string;
  sort: string;
};
export function employeeStatus(employee: HRRecord) {
  return String(
    employee.data.employmentStatus || employee.data.status || "Unassigned",
  );
}
export function directoryPeople(
  employees: HRRecord[],
  departments: HRRecord[],
  filters: DirectoryFilters,
) {
  const names = new Map(departments.map((d) => [d.id, String(d.data.name)]));
  const search = filters.search.trim().toLocaleLowerCase();
  const rows = employees.filter(
    (e) =>
      (!filters.department ||
        (filters.department === "unassigned"
          ? !e.data.departmentId
          : e.data.departmentId === filters.department)) &&
      (!filters.status || employeeStatus(e) === filters.status) &&
      (!filters.employment || e.data.employmentType === filters.employment) &&
      (!search ||
        [
          e.data.name,
          e.data.title,
          e.data.email,
          names.get(String(e.data.departmentId)),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search)),
  );
  return rows.sort((a, b) => {
    const field =
      filters.sort === "department"
        ? (e: HRRecord) =>
            names.get(String(e.data.departmentId)) || "Unassigned"
        : (e: HRRecord) => String(e.data.name || "");
    const compared =
      field(a).localeCompare(field(b), "en-MY", { sensitivity: "base" }) ||
      String(a.data.name).localeCompare(String(b.data.name));
    return filters.sort === "name-desc" ? -compared : compared;
  });
}

/** One level at a time, so invalid/circular reporting data cannot recurse. */
export function reportingGroups(employees: HRRecord[]) {
  const active = employees.filter((e) => e.data.status !== "Archived");
  const ids = new Set(active.map((e) => e.id));
  const groups = new Map<string, HRRecord[]>();
  for (const employee of active) {
    const manager = String(employee.data.managerId || "");
    const key =
      manager && manager !== employee.id && ids.has(manager)
        ? manager
        : "unassigned";
    groups.set(key, [...(groups.get(key) || []), employee]);
  }
  return [...groups].map(([id, reports]) => ({
    id,
    manager: active.find((e) => e.id === id),
    reports,
  }));
}
