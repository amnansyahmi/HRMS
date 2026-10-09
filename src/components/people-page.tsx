"use client";
import { useState } from "react";
import { Pencil, Building2, ArrowUpRight, Download } from "lucide-react";
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
import { money, shortDate } from "@/lib/client";
import { isStaff, type HRRecord } from "@/lib/types";
export function PeoplePage() {
  const { workspace, edit } = useWorkspace(),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("employees"),
    [selected, setSelected] = useState<HRRecord | null>(null),
    staff = isStaff(workspace.actor);
  const employees = workspace.records.filter((r) => r.kind === "employee"),
    departments = workspace.records.filter((r) => r.kind === "department"),
    filtered = employees.filter((e) =>
      JSON.stringify(e.data).toLowerCase().includes(search.toLowerCase()),
    ),
    departmentName = (id: unknown) =>
      String(departments.find((d) => d.id === id)?.data.name || "Unassigned");
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
                  tab === "employees"
                    ? "employee"
                    : tab === "designations"
                      ? "designation"
                      : "department",
                )
              }
            >
              {tab === "employees"
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
        </TabsList>
        <TabsContent value="employees">
          <div className="table-toolbar">
            <SearchField
              value={search}
              onChange={setSearch}
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
          {filtered.length ? (
            <div className="table-wrap">
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
                  {filtered.map((e) => (
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
                      <td>{departmentName(e.data.departmentId)}</td>
                      <td>{String(e.data.employmentType)}</td>
                      <td>
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
                search ? "No matching people" : "Build your team directory"
              }
              description={
                search
                  ? "Try a different name or role."
                  : "Add your first employee and create their profile."
              }
            />
          )}
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
