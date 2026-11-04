# Inspection Templates

Settings → Inspection templates. An inspection report is an Excel workbook built from a template: BluePLM opens
the template, fills in the tokens you typed into its cells, repeats the table row once per characteristic and adds
the ballooned drawing. Any workbook can be a template. You lay it out in Excel the way your company wants it, and
the tokens tell BluePLM where things go.

Without a template of your own, reports use the built-in ones. They are a good place to start: download one under
Starter templates, change it in Excel and add it back.

## Making a template

1. Lay out the sheet in Excel: logo, title block, header fields, column captions, borders, fonts, print area.
2. Type tokens into the cells BluePLM should fill. A token is a name in double braces, such as `{{PART_NUMBER}}`.
   Header tokens can sit anywhere in a cell's text, so `Part: {{PART_NUMBER}} rev {{REVISION}}` works.
3. Make one table row: the first row holding `{{COL:...}}` tokens. It is copied once per characteristic, with
   its formatting, and the rows under it move down.
4. Add it to BluePLM, either through the templates folder (below) or with Upload template.

BluePLM analyses the workbook when it is added and shows Ready, Warnings or Errors next to it. Errors (for
example no table row) stop the template from being used. Warnings (an unknown token, say) do not.

## Tokens

The full list is at the bottom of the Inspection templates page. The main ones:

| Token | What goes there |
| --- | --- |
| `{{PART_NUMBER}}`, `{{REVISION}}`, `{{DESCRIPTION}}`, `{{DRAWING_NAME}}`, `{{DRAWING_VERSION}}` | The drawing version the report is of |
| `{{REPORT_NUMBER}}`, `{{DATE}}`, `{{ORG_NAME}}`, `{{REPORT_TYPE}}` | The report itself |
| `{{GENERAL_TOLERANCES}}` | The drawing's general tolerances, when the title block has them |
| `{{LOT_NUMBER}}`, `{{LOT_SIZE}}`, `{{SAMPLING_PLAN}}`, `{{PO_NUMBER}}`, `{{SUPPLIER}}`, `{{FAI_TYPE}}`, ... | Report type fields, blank when the type has none |
| `{{PROP:<name>}}` | A custom property of the drawing, such as `{{PROP:Material}}` |
| `{{ENTRY:<name>}}` | A cell the supplier fills in (serial number, sign-off). Read back when the workbook is imported |
| `{{LOGO}}` | The organization logo, fitted to the cell or its merged range |
| `{{DRAWING}}` | Where the drawing pages go. Without it they go under the table |
| `{{COL:<field>}}` | In the table row: a characteristic field, such as `{{COL:balloon_number}}`, `{{COL:nominal_value}}`, `{{COL:tolerance}}`, `{{COL:spec}}` |
| `{{RESULT}}`, `{{RESULT:2}}`, ... | In the table row: measured values, left blank and unlocked for the supplier |
| `{{VERDICT}}` | In the table row: pass / fail, worked out from the results on import |
| `{{INPUT:<name>}}` | In the table row: free text per row, such as the measuring tool |

Tokens from the old Google Sheets templates (`{{BR_NUMBER}}`, `{{INSPECTION_TABLE}}`, `{{COL:balloon}}`) still
work.

## Templates folder

Templates can live in the vault, like the SOLIDWORKS template folders. An administrator picks a vault and a folder
under Templates folder (typed, such as `_templates/Inspection`, or with Browse when the vault is on this computer).
Every checked-in `.xlsx` in that folder and its subfolders is then an organization template for everyone.

- To change a template, check it out, edit it in Excel and check it in. The next report uses the new version, and
  the template's revision goes up by one.
- To add a template, check a new workbook into the folder. Its name is the file name.
- To retire a template, move it out of the folder or delete it. It is archived, and comes back if the file does.
- Name, description, report types and defaults are still set on the Inspection templates page.

BluePLM syncs the folder whenever the page is opened and before each report is generated. Reports keep the exact
workbook they were made from, so changing a template never changes a report that already exists. A member without
access to the folder's vault keeps getting the templates as they were last synced.

## Report types and defaults

Each template can be limited to some report types (FAI, production, receiving, reinspection) and be the default
for some of them. One template per type is the default, and setting a new one moves it.
