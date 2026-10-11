"use client";
import { useState, useDeferredValue } from "react";
import {
  Pencil,
  Building2,
  ArrowUpRight,
  Download,
  Sparkles,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWorkspace } from "./workspace-context";
import {
  PageHeader,
  Person,
  Status,
  SearchField,
  Empty,
  AddButton,
} from "./common";
import { OrganizationView } from "./organization-view";
import { ResultPagination, FilterChip } from "./data-controls";
import {
  directoryPeople,
  employeeStatus,
  type DirectoryFilters,
} from "@/lib/people-directory";
import { money, shortDate } from "@/lib/client";
import { isStaff, type HRRecord } from "@/lib/types";
export function PeoplePage() {
  const { workspace, edit, ask } = useWorkspace(),
    [filters, setFilters] = useState<DirectoryFilters>({
      search: "",
      department: "",
      status: "",
      employment: "",
      sort: "name-asc",
    }),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [tab, setTab] = useState("employees"),
    [selected, setSelected] = useState<HRRecord | null>(null),
    staff = isStaff(workspace.actor);
  const employees = workspace.records.filter((r) => r.kind === "employee"),
    departments = workspace.records.filter((r) => r.kind === "department"),
    deferredSearch = useDeferredValue(filters.search),
    search = filters.search,
    filtered = directoryPeople(employees, departments, {
      ...filters,
      search: deferredSearch,
    }),
    currentPage = Math.min(
      page,
      Math.max(1, Math.ceil(filtered.length / pageSize)),
    ),
    rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    departmentName = (id: unknown) =>
      String(departments.find((d) => d.id === id)?.data.name || "Unassigned");
  function filter(key: keyof DirectoryFilters, value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(1);
  }
  return (
    <>
      <PageHeader
        title="People"
        description="The people behind the work."
        action={
          staff ? (
            <AddButton
              onClick={() =>
                edit(
                  ["employees", "organization"].includes(tab)
                    ? "employee"
                    : tab === "designations"
                      ? "designation"
                      : "department",
                )
              }
            >
              {["employees", "organization"].includes(tab)
                ? "Add employee"
                : tab === "designations"
                  ? "Add designation"
                  : "Add department"}
            </AddButton>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="employees">
            Employees <span className="tab-count">{employees.length}</span>
          </TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="designations">Designations</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
        </TabsList>
        <TabsContent value="employees">
          <div className="table-toolbar">
            <SearchField
              value={search}
              onChange={(value) => filter("search", value)}
              placeholder="Search people, roles or email…"
            />
            {staff ? (
              <Button variant="outline" size="sm" asChild>
                <a href="/api/export?type=employees">
                  <Download size={14} />
                  Export CSV
                </a>
              </Button>
            ) : null}
          </div>
          <div className="directory-filters">
            <label>
              Department
              <select
                className="native-select"
                aria-label="Department"
                value={filters.department}
                onChange={(e) => filter("department", e.target.value)}
              >
                <option value="">All departments</option>
                <option value="unassigned">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {String(d.data.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                className="native-select"
                aria-label="Status"
                value={filters.status}
                onChange={(e) => filter("status", e.target.value)}
              >
                <option value="">All statuses</option>
                {Array.from(new Set(employees.map(employeeStatus)))
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              Employment
              <select
                className="native-select"
                aria-label="Employment"
                value={filters.employment}
                onChange={(e) => filter("employment", e.target.value)}
              >
                <option value="">All types</option>
                {Array.from(
                  new Set(
                    employees.map((e) => String(e.data.employmentType || "")),
                  ),
                )
                  .filter(Boolean)
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              Sort by
              <select
                className="native-select"
                aria-label="Sort by"
                value={filters.sort}
                onChange={(e) => filter("sort", e.target.value)}
              >
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
                <option value="department">Department</option>
              </select>
            </label>
          </div>
          <div className="active-filters">
            {(["department", "status", "employment"] as const)
              .filter((key) => filters[key])
              .map((key) => (
                <FilterChip
                  key={key}
                  label={
                    key === "department"
                      ? departmentName(filters[key])
                      : filters[key]
                  }
                  clear={() => filter(key, "")}
                />
              ))}
          </div>
          {filtered.length ? (
            <div className="table-wrap people-table">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Employment</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          className="person-button"
                          onClick={() => setSelected(e)}
                        >
                          <Person
                            name={String(e.data.name)}
                            detail={String(e.data.title)}
                          />
                        </button>
                      </td>
                      <td data-label="Department">
                        {departmentName(e.data.departmentId)}
                      </td>
                      <td data-label="Employment">
                        {String(e.data.employmentType || "Unassigned")}
                      </td>
                      <td data-label="Status">
                        <Status
                          value={e.data.employmentStatus || e.data.status}
                        />
                      </td>
                      <td>
                        {staff ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${e.data.name}`}
                            onClick={() => edit("employee", e)}
                          >
                            <Pencil size={15} />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`View ${e.data.name}`}
                            onClick={() => setSelected(e)}
                          >
                            <ArrowUpRight size={15} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                search ||
                filters.department ||
                filters.status ||
                filters.employment
                  ? "No matching people"
                  : "Build your team directory"
              }
              description={
                search ||
                filters.department ||
                filters.status ||
                filters.employment
                  ? "Try a different search or clear your filters."
                  : "Add your first employee and create their profile."
              }
            />
          )}
          <ResultPagination
            count={filtered.length}
            page={currentPage}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
          {workspace.truncated ? (
            <p className="scope-note">
              Results cover the records currently loaded in this workspace.
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="organization">
          <OrganizationView employees={employees} onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="departments">
          <div className="record-cards">
            {departments.map((d) => (
              <div className="record-card" key={d.id}>
                <div className="row-between">
                  <Building2 size={22} />
                  {staff ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${d.data.name}`}
                      onClick={() => edit("department", d)}
                    >
                      <Pencil size={15} />
                    </Button>
                  ) : null}
                </div>
                <h3>{String(d.data.name)}</h3>
                <p>{String(d.data.description || "")}</p>
                <small>
                  {employees.filter((e) => e.data.departmentId === d.id).length}{" "}
                  people
                </small>
              </div>
            ))}
          </div>
          {!departments.length ? (
            <Empty
              title="A place for every team"
              description="Add departments to organise your company."
            />
          ) : null}
        </TabsContent>
        <TabsContent value="designations">
          <div className="record-cards">
            {workspace.records
              .filter((r) => r.kind === "designation")
              .map((r) => (
                <article className="record-card" key={r.id}>
                  <h3>{String(r.data.name)}</h3>
                  <p>{String(r.data.description || "")}</p>
                  {staff ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => edit("designation", r)}
                    >
                      Edit designation
                    </Button>
                  ) : null}
                </article>
              ))}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Employee profile</DialogTitle>
            <DialogDescription>
              Details available to your account.
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <>
              <Person
                name={String(selected.data.name)}
                detail={String(selected.data.title)}
              />
              <dl className="detail-grid">
                <dt>Department</dt>
                <dd>{departmentName(selected.data.departmentId)}</dd>
                <dt>Reports to</dt>
                <dd>
                  {String(
                    employees.find((e) => e.id === selected.data.managerId)
                      ?.data.name || "—",
                  )}
                </dd>
                <dt>Employment</dt>
                <dd>{String(selected.data.employmentType)}</dd>
                <dt>Status</dt>
                <dd>
                  <Status
                    value={
                      selected.data.employmentStatus || selected.data.status
                    }
                  />
                </dd>
                {selected.data.email ? (
                  <>
                    <dt>Email</dt>
                    <dd>{String(selected.data.email)}</dd>
                    <dt>Joined</dt>
                    <dd>{shortDate(selected.data.startDate)}</dd>
                    <dt>Base salary</dt>
                    <dd>{money(selected.data.salary)} / month</dd>
                    <dt>Annual allowance</dt>
                    <dd>{Number(selected.data.annualLeave)} days</dd>
                    <dt>Sick allowance</dt>
                    <dd>{Number(selected.data.sickLeave)} days</dd>
                  </>
                ) : null}
              </dl>
              <Button
                variant="outline"
                onClick={() => {
                  ask(
                    "hr",
                    selected.id,
                    "Help me review this employee profile and any follow-ups that need attention.",
                  );
                  setSelected(null);
                }}
              >
                <Sparkles size={16} />
                Ask AI about this employee
              </Button>
              {staff ? (
                <Button
                  onClick={() => {
                    edit("employee", selected);
                    setSelected(null);
                  }}
                >
                  <Pencil size={14} />
                  Edit profile
                </Button>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
