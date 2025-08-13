from datetime import datetime, timezone, timedelta

now = datetime.now(timezone.utc)
print(f'Today: {now.strftime("%a %b %d %Y")} (weekday: {now.weekday()})')

# Python weekday: Monday=0, Tuesday=1, ..., Friday=4, Saturday=5, Sunday=6
days_until_friday = (4 - now.weekday()) % 7
print(f'Days until Friday calc: {days_until_friday}')

if days_until_friday == 0:
    days_until_friday = 7

next_friday = now + timedelta(days=days_until_friday)
print(f'Next Friday: {next_friday.strftime("%a %b %d %Y")}') 