import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { SelectField } from "@/components/ui/SelectField";
import { Input } from "@/components/ui/Input";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import {
  Globe,
  Loader2,
  Search,
  Shield,
  Clock,
  Calendar,
  DollarSign,
  Heart,
  Briefcase,
} from "lucide-react";

const COUNTRY_FLAGS: Record<string, string> = {
  IN: "\uD83C\uDDEE\uD83C\uDDF3",
  US: "\uD83C\uDDFA\uD83C\uDDF8",
  GB: "\uD83C\uDDEC\uD83C\uDDE7",
  DE: "\uD83C\uDDE9\uD83C\uDDEA",
  FR: "\uD83C\uDDEB\uD83C\uDDF7",
  CA: "\uD83C\uDDE8\uD83C\uDDE6",
  AU: "\uD83C\uDDE6\uD83C\uDDFA",
  SG: "\uD83C\uDDF8\uD83C\uDDEC",
  AE: "\uD83C\uDDE6\uD83C\uDDEA",
  JP: "\uD83C\uDDEF\uD83C\uDDF5",
  BR: "\uD83C\uDDE7\uD83C\uDDF7",
  MX: "\uD83C\uDDF2\uD83C\uDDFD",
  KR: "\uD83C\uDDF0\uD83C\uDDF7",
  NL: "\uD83C\uDDF3\uD83C\uDDF1",
  ES: "\uD83C\uDDEA\uD83C\uDDF8",
  IT: "\uD83C\uDDEE\uD83C\uDDF9",
  SE: "\uD83C\uDDF8\uD83C\uDDEA",
  CH: "\uD83C\uDDE8\uD83C\uDDED",
  IE: "\uD83C\uDDEE\uD83C\uDDEA",
  PL: "\uD83C\uDDF5\uD83C\uDDF1",
  PH: "\uD83C\uDDF5\uD83C\uDDED",
  ID: "\uD83C\uDDEE\uD83C\uDDE9",
  MY: "\uD83C\uDDF2\uD83C\uDDFE",
  TH: "\uD83C\uDDF9\uD83C\uDDED",
  VN: "\uD83C\uDDFB\uD83C\uDDF3",
  ZA: "\uD83C\uDDFF\uD83C\uDDE6",
  NG: "\uD83C\uDDF3\uD83C\uDDEC",
  KE: "\uD83C\uDDF0\uD83C\uDDEA",
  EG: "\uD83C\uDDEA\uD83C\uDDEC",
  SA: "\uD83C\uDDF8\uD83C\uDDE6",
};

const REGION_OPTIONS = [
  { value: "", label: "All Regions" },
  { value: "asia", label: "Asia" },
  { value: "europe", label: "Europe" },
  { value: "americas", label: "Americas" },
  { value: "africa", label: "Africa" },
  { value: "oceania", label: "Oceania" },
  { value: "middle_east", label: "Middle East" },
];

export function CountryCompliancePage() {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  // When the user lands here from the Global Dashboard "Countries" card
  // (?configured=true), narrow the list to countries the org actually has
  // employees in. Defaults to false so the page still doubles as a global
  // catalogue when accessed directly (#235).
  const [configuredOnly, setConfiguredOnly] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("configured") === "true";
  });

  const { data: countriesRes, isLoading } = useQuery({
    queryKey: ["global-countries", regionFilter],
    queryFn: () => apiGet<any>("/global/countries", { region: regionFilter || undefined }),
  });

  // Pull the dashboard payload to know which countries the org has set up.
  // Already cached if the user came from the dashboard.
  const { data: dashRes } = useQuery({
    queryKey: ["global-dashboard"],
    queryFn: () => apiGet<any>("/global/dashboard"),
    enabled: configuredOnly,
  });

  const { data: countryDetail } = useQuery({
    queryKey: ["global-country", selectedCountryId],
    queryFn: () => apiGet<any>(`/global/countries/${selectedCountryId}`),
    enabled: !!selectedCountryId,
  });

  const configuredCountryCodes = new Set<string>(
    (dashRes?.data?.employeesByCountry || [])
      .map((c: any) => (c.country_code || c.code || "").toUpperCase())
      .filter(Boolean),
  );

  const countries = (countriesRes?.data || []).filter((c: any) => {
    if (configuredOnly && configuredCountryCodes.size > 0) {
      if (!configuredCountryCodes.has((c.code || "").toUpperCase())) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
  });

  const detail = countryDetail?.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Country Compliance"
        description="Browse labor laws, tax rates, and statutory requirements by country"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Country List */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  className="pl-10"
                  placeholder="Search countries..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <SelectField
                options={REGION_OPTIONS}
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
              />
              {configuredCountryCodes.size > 0 && (
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={configuredOnly}
                    onChange={(e) => setConfiguredOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Only my configured countries ({configuredCountryCodes.size})
                </label>
              )}
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[600px] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
                  {countries.map((c: any) => (
                    <button
                      key={c.id}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                        selectedCountryId === c.id ? "bg-brand-50 dark:bg-brand-950" : ""
                      }`}
                      onClick={() => setSelectedCountryId(c.id)}
                    >
                      <span className="text-xl">{COUNTRY_FLAGS[c.code] || ""}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                          {c.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {c.currency} ({c.currency_symbol}) - {c.region.replace("_", " ")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Country Detail */}
        <div className="lg:col-span-2">
          {detail ? (
            <div className="space-y-6">
              <Card>
                <CardContent className="p-6">
                  <div className="mb-6 flex items-center gap-4">
                    <span className="text-4xl">{COUNTRY_FLAGS[detail.code] || ""}</span>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {detail.name}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {detail.currency} ({detail.currency_symbol}) -{" "}
                        {detail.region.replace("_", " ")}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                    <div className="flex items-start gap-3">
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
                      <div>
                        <p className="text-xs text-gray-500">Max Work Hours/Week</p>
                        <p className="text-lg font-bold">{detail.max_work_hours_week} hrs</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
                      <div>
                        <p className="text-xs text-gray-500">Annual Leave</p>
                        <p className="text-lg font-bold">{detail.annual_leave_days} days</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
                      <div>
                        <p className="text-xs text-gray-500">Public Holidays</p>
                        <p className="text-lg font-bold">{detail.public_holidays} days</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Shield className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
                      <div>
                        <p className="text-xs text-gray-500">Notice Period</p>
                        <p className="text-lg font-bold">{detail.notice_period_days} days</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-teal-500" />
                      <div>
                        <p className="text-xs text-gray-500">Probation</p>
                        <p className="text-lg font-bold">{detail.probation_months} months</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <DollarSign className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                      <div>
                        <p className="text-xs text-gray-500">Pay Frequency</p>
                        <p className="text-lg font-bold capitalize">{detail.payroll_frequency}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Statutory Benefits */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                    Statutory Benefits
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div
                      className={`rounded-lg p-4 text-center ${detail.has_social_security ? "bg-green-50 dark:bg-green-900/20" : "bg-gray-50 dark:bg-gray-800/50"}`}
                    >
                      <Shield
                        className={`mx-auto h-6 w-6 ${detail.has_social_security ? "text-green-600" : "text-gray-400"}`}
                      />
                      <p className="mt-2 text-sm font-medium">Social Security</p>
                      <p
                        className={`text-xs ${detail.has_social_security ? "text-green-600" : "text-gray-400"}`}
                      >
                        {detail.has_social_security ? "Required" : "Not Required"}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-4 text-center ${detail.has_pension ? "bg-blue-50 dark:bg-blue-900/20" : "bg-gray-50 dark:bg-gray-800/50"}`}
                    >
                      <DollarSign
                        className={`mx-auto h-6 w-6 ${detail.has_pension ? "text-blue-600" : "text-gray-400"}`}
                      />
                      <p className="mt-2 text-sm font-medium">Pension</p>
                      <p
                        className={`text-xs ${detail.has_pension ? "text-blue-600" : "text-gray-400"}`}
                      >
                        {detail.has_pension ? "Required" : "Not Required"}
                      </p>
                    </div>
                    <div
                      className={`rounded-lg p-4 text-center ${detail.has_health_insurance ? "bg-purple-50 dark:bg-purple-900/20" : "bg-gray-50 dark:bg-gray-800/50"}`}
                    >
                      <Heart
                        className={`mx-auto h-6 w-6 ${detail.has_health_insurance ? "text-purple-600" : "text-gray-400"}`}
                      />
                      <p className="mt-2 text-sm font-medium">Health Insurance</p>
                      <p
                        className={`text-xs ${detail.has_health_insurance ? "text-purple-600" : "text-gray-400"}`}
                      >
                        {detail.has_health_insurance ? "Required" : "Not Required"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tax & Compliance Rates */}
              {detail.compliance_notes && Object.keys(detail.compliance_notes).length > 0 && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                      Tax & Social Security Rates
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(detail.compliance_notes).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800/50"
                        >
                          <span className="text-sm capitalize text-gray-600 dark:text-gray-400">
                            {key.replace(/_/g, " ")}
                          </span>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {typeof value === "number" ? `${value}%` : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Additional Info */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
                    Additional Information
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Tax Year Start</p>
                      <p className="font-medium">{detail.tax_year_start}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Minimum Wage (Monthly)</p>
                      <p className="font-medium">
                        {detail.min_wage_monthly
                          ? `${detail.currency_symbol} ${(Number(detail.min_wage_monthly) / 100).toLocaleString()}`
                          : "Not set / Varies"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Country Code</p>
                      <p className="font-medium">{detail.code}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Region</p>
                      <p className="font-medium capitalize">{detail.region.replace("_", " ")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex h-64 flex-col items-center justify-center p-6 text-center">
                <Globe className="mb-3 h-12 w-12 text-gray-300" />
                <p className="text-gray-500">Select a country to view compliance details</p>
                <p className="mt-1 text-xs text-gray-400">
                  Browse labor laws, tax rates, and statutory requirements
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
