import { useEffect } from "react";
import { Alert, Button, Paper, TextField, Typography } from "@mui/material";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import * as scoringApi from "../../api/scoring";
import { PageError, PageHeader } from "../../components/DataComponents";
import type { ScoringConfig } from "../../types/scoring";
import { apiErrorMessage } from "../../utils/errors";
import { formatDateTime } from "../../utils/format";

// Same limits as the backend and the database CHECK constraints.
const number = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, message)
    .transform(Number);

const settingsSchema = z
  .object({
    p0: number("Enter a number between 0 and 1").refine(
      (value) => value > 0 && value < 1,
      "Must be between 0 and 1",
    ),
    k: number("Enter a positive number").refine(
      (value) => value > 0,
      "Must be greater than 0",
    ),
    min_users_for_band: number("Enter a whole number").refine(
      (value) => Number.isInteger(value) && value >= 1,
      "Must be a whole number of at least 1",
    ),
    high_risk_below: number("Enter a number from 0 to 100").refine(
      (value) => value <= 100,
      "Must be from 0 to 100",
    ),
    watch_below: number("Enter a number from 0 to 100").refine(
      (value) => value <= 100,
      "Must be from 0 to 100",
    ),
    device_email_rule_min: number("Enter a whole number").refine(
      (value) => Number.isInteger(value) && value >= 3,
      "Must be a whole number of at least 3",
    ),
  })
  .refine((values) => values.high_risk_below <= values.watch_below, {
    path: ["watch_below"],
    message: "Must be at least the High risk limit",
  });

type SettingsInput = z.input<typeof settingsSchema>;

const fields: {
  name: keyof ScoringConfig;
  label: string;
  help: string;
}[] = [
  {
    name: "p0",
    label: "Expected flag rate (p0)",
    help: "Expected share of flagged customers on the platform, between 0 and 1. New agents start from this rate.",
  },
  {
    name: "k",
    label: "Smoothing strength (k)",
    help: "How many 'average' customers are added to every agent's record. Higher values make reputations change more slowly.",
  },
  {
    name: "min_users_for_band",
    label: "Customers needed for a band",
    help: "Below this number of customers an agent's band is 'Insufficient data'.",
  },
  {
    name: "high_risk_below",
    label: "High risk below",
    help: "A reputation below this is High risk.",
  },
  {
    name: "watch_below",
    label: "Watch below",
    help: "A reputation below this (but not High risk) is Watch; at or above it is Low risk. Must be at least the High risk limit.",
  },
  {
    name: "device_email_rule_min",
    label: "Device email rule",
    help: "Flag a registration when one device was used for at least this many different email addresses in 8 weeks. At least 3, because the model never saw more than 2.",
  },
];

function asInput(config: ScoringConfig): SettingsInput {
  return Object.fromEntries(
    Object.entries(config).map(([name, value]) => [name, String(value)]),
  ) as SettingsInput;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["admin", "scoring-config"],
    queryFn: scoringApi.getScoringConfig,
  });
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<SettingsInput, unknown, ScoringConfig>({
    resolver: zodResolver(settingsSchema),
  });
  const saveMutation = useMutation({
    mutationFn: scoringApi.updateScoringConfig,
    onSuccess: (saved) => {
      queryClient.setQueryData(["admin", "scoring-config"], saved);
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
    },
  });

  const config = configQuery.data;
  useEffect(() => {
    if (config) reset(asInput(config));
  }, [config, reset]);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Settings"
        description="Reputation and rule settings. Changes apply at once, because reputation is calculated when it is read."
      />
      {configQuery.isError && (
        <PageError message="The settings could not be loaded." />
      )}
      <Paper className="chart-card" variant="outlined" square>
        <form
          className="settings-form"
          noValidate
          onSubmit={handleSubmit((values) => saveMutation.mutate(values))}
        >
          {fields.map((field) => (
            <TextField
              key={field.name}
              label={field.label}
              inputMode="decimal"
              slotProps={{ inputLabel: { shrink: true } }}
              {...register(field.name)}
              error={Boolean(errors[field.name])}
              helperText={errors[field.name]?.message ?? field.help}
            />
          ))}
          {saveMutation.isError && (
            <Alert severity="error">
              {apiErrorMessage(saveMutation.error, "Settings were not saved.")}
            </Alert>
          )}
          {saveMutation.isSuccess && (
            <Alert severity="success">Settings saved.</Alert>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={!config || saveMutation.isPending}
            sx={{ justifySelf: "start" }}
          >
            Save settings
          </Button>
          {config && (
            <Typography color="text.secondary" variant="body2">
              Last updated {formatDateTime(config.updated_at)}
              {config.updated_by ? ` by user ${config.updated_by}` : ""}.
            </Typography>
          )}
        </form>
      </Paper>
    </>
  );
}
