"use client";
import { GitBranch, Users } from "lucide-react";
import { reportingGroups } from "@/lib/people-directory";
import type { HRRecord } from "@/lib/types";
import { Person, Empty } from "./common";

export function OrganizationView({
  employees,
  onSelect,
}: {
  employees: HRRecord[];
  onSelect: (employee: HRRecord) => void;
}) {
  const groups = reportingGroups(employees);
  if (!groups.length)
    return (
      <Empty
        title="Build your organization"
        description="Add employees and their reporting managers to see teams here."
      />
    );
  return (
    <section className="organization-view" aria-label="Reporting teams">
      <p className="scope-note">
        Reporting relationships from your available employee records. Select a
        person to view their profile.
      </p>
      <div className="organization-grid">
        {groups
          .sort((a, b) =>
            String(a.manager?.data.name || "").localeCompare(
              String(b.manager?.data.name || ""),
            ),
          )
          .map((group) => (
            <section className="organization-team" key={group.id}>
              <header>
                {group.manager ? (
                  <button onClick={() => onSelect(group.manager!)}>
                    <GitBranch size={18} aria-hidden="true" />
                    <Person
                      name={String(group.manager.data.name)}
                      detail={String(group.manager.data.title || "Manager")}
                    />
                  </button>
                ) : (
                  <h2>
                    <Users size={18} aria-hidden="true" />
                    No available reporting manager
                  </h2>
                )}
                <span>
                  {group.reports.length}{" "}
                  {group.reports.length === 1 ? "person" : "people"}
                </span>
              </header>
              <ul>
                {group.reports.map((person) => (
                  <li key={person.id}>
                    <button onClick={() => onSelect(person)}>
                      <Person
                        name={String(person.data.name)}
                        detail={String(person.data.title || "")}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </section>
  );
}
