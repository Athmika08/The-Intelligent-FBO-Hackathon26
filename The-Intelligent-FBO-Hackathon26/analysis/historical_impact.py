"""Historical Super Bowl impact calculations for the Intelligent FBO project.

The verified historical anchor points used here are:
- Super Bowl LVII (Phoenix, 2023): event-period average daily business-jet arrivals
  were about 1.9x the February 2023 daily average.
- Super Bowl LVIII (Las Vegas, 2024): event-period average daily business-jet arrivals
  were about 1.5x the February-to-date daily average.

The seven-day multipliers are planning assumptions informed by those historical ratios
and published peak-arrival windows. They are NOT observed daily historical percentages.
"""

historical_ratios = {
    "Phoenix_2023": 1.9,
    "Las_Vegas_2024": 1.5,
}

average_historical_ratio = sum(historical_ratios.values()) / len(historical_ratios)
percent_increase = (average_historical_ratio - 1) * 100

medium_multipliers = {
    "Wednesday": 1.10,
    "Thursday": 1.25,
    "Friday": 1.55,
    "Saturday": 2.00,
    "Sunday": 1.55,
    "Monday": 1.05,
    "Tuesday": 1.00,
}

fri_sun_avg = (
    medium_multipliers["Friday"]
    + medium_multipliers["Saturday"]
    + medium_multipliers["Sunday"]
) / 3

print("Verified historical ratios:")
for event, ratio in historical_ratios.items():
    print(f"  {event}: {ratio:.1f}x ({(ratio - 1) * 100:.0f}% above normal)")

print(f"\nMean historical event ratio: {average_historical_ratio:.2f}x")
print(f"Mean historical increase: {percent_increase:.0f}%")
print(f"Synthetic Fri-Sun medium-scenario average: {fri_sun_avg:.2f}x")

print("\nSeven-day medium multipliers (synthetic planning assumptions):")
for day, multiplier in medium_multipliers.items():
    print(f"  {day}: {multiplier:.2f}x ({(multiplier - 1) * 100:+.0f}%)")
